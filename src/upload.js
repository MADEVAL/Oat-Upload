(() => {
  const name = 'ot-upload';

  if (customElements.get(name)) {
    return;
  }

  const messages = {
    disabled: 'File upload is disabled.',
    count: 'Too many files selected.',
    size: 'File is too large.',
    type: 'File type is not allowed.'
  };

  class OtUpload extends HTMLElement {
    #controller;
    #input;
    #dropzone;
    #list;
    #status;
    #error;
    #progress;
    #items = [];
    #dragDepth = 0;

    connectedCallback() {
      this.#controller = new AbortController();
      this.#init();
    }

    disconnectedCallback() {
      this.#controller?.abort();
      this.#items.forEach(item => this.#revoke(item));
    }

    get files() {
      return this.#items.map(item => item.file);
    }

    addFiles(files) {
      return this.#addFiles(Array.from(files || []));
    }

    remove(target) {
      const index = this.#findIndex(target);
      if (index < 0) {
        return null;
      }

      const [item] = this.#items.splice(index, 1);
      this.#revoke(item);
      this.#syncInput();
      this.#render();
      this.#emitChange({ removed: [item.file] });
      return item.file;
    }

    clear() {
      if (!this.#items.length) {
        return;
      }

      const removed = this.files;
      this.#items.forEach(item => this.#revoke(item));
      this.#items = [];
      this.#clearNativeInput();
      this.#render();
      this.#emitChange({ removed });
    }

    setProgress(value, target) {
      const progress = target === undefined ? this.#progress : this.#findItem(target)?.progress;
      if (!progress) {
        return;
      }

      if (value === null || value === undefined) {
        progress.hidden = true;
        progress.removeAttribute('value');
        return;
      }

      const next = Math.max(0, Math.min(100, Number(value) || 0));
      progress.max = 100;
      progress.value = next;
      progress.hidden = false;
    }

    resetProgress(target) {
      this.setProgress(null, target);
    }

    #init() {
      this.#input = this.querySelector('input[type="file"]');

      if (!this.#input) {
        console.warn('ot-upload: Missing input[type="file"] element');
        return;
      }

      this.#input.setAttribute('data-upload-input', '');
      this.#dropzone = this.querySelector('[data-upload-dropzone]') || this.#createDropzone();
      this.#list = this.querySelector('[data-upload-list]') || this.#createList();
      this.#status = this.querySelector('[data-upload-status]') || this.#createOutput('data-upload-status');
      this.#error = this.querySelector('[data-upload-error]') || this.#createOutput('data-upload-error');
      this.#progress = this.querySelector('[data-upload-progress]') || this.#createProgress();

      if (this.hasAttribute('accept') && !this.#input.hasAttribute('accept')) {
        this.#input.setAttribute('accept', this.getAttribute('accept'));
      }

      this.setAttribute('data-enhanced', '');
      this.#syncDisabled();
      this.#bind();
      this.#render();
    }

    #bind() {
      const signal = this.#controller.signal;

      this.#input.addEventListener('change', () => {
        this.#addFiles(Array.from(this.#input.files || []));
        this.#clearNativeInput(false);
      }, { signal });

      this.#dropzone.addEventListener('click', event => {
        if (this.#isDisabled()) {
          event.preventDefault();
          this.#reject(null, 'disabled');
          return;
        }

        if (!this.#dropzone.matches('label') && event.target !== this.#input) {
          this.#input.click();
        }
      }, { signal });

      this.#dropzone.addEventListener('keydown', event => {
        if (!['Enter', ' '].includes(event.key) || this.#dropzone.matches('label')) {
          return;
        }

        event.preventDefault();
        this.#input.click();
      }, { signal });

      ['dragenter', 'dragover'].forEach(type => {
        this.#dropzone.addEventListener(type, event => this.#onDrag(event), { signal });
      });

      this.#dropzone.addEventListener('dragleave', event => this.#onDragLeave(event), { signal });
      this.#dropzone.addEventListener('drop', event => this.#onDrop(event), { signal });

      this.#list.addEventListener('click', event => {
        const button = event.target.closest('[data-upload-remove]');
        if (!button) {
          return;
        }

        this.remove(button.closest('[data-upload-item]')?.getAttribute('data-upload-id'));
      }, { signal });
    }

    #createDropzone() {
      const label = document.createElement('label');
      label.setAttribute('data-upload-dropzone', '');

      const id = this.#input.id || `ot-upload-${Math.random().toString(36).slice(2, 10)}`;
      this.#input.id = id;
      label.htmlFor = id;
      label.innerHTML = `
        <span data-upload-kicker aria-hidden="true"></span>
        <span data-upload-title>Choose files or drop them here</span>
        <small data-upload-hint>${this.#hintText()}</small>
      `;

      this.#input.before(label);
      label.prepend(this.#input);
      return label;
    }

    #createList() {
      const list = document.createElement('ul');
      list.setAttribute('data-upload-list', '');
      list.setAttribute('aria-label', 'Selected files');
      this.appendChild(list);
      return list;
    }

    #createOutput(attribute) {
      const output = document.createElement('output');
      output.setAttribute(attribute, '');
      output.setAttribute('aria-live', 'polite');
      this.appendChild(output);
      return output;
    }

    #createProgress() {
      const progress = document.createElement('progress');
      progress.setAttribute('data-upload-progress', '');
      progress.max = 100;
      progress.value = 0;
      progress.hidden = true;
      this.appendChild(progress);
      return progress;
    }

    #onDrag(event) {
      event.preventDefault();

      if (this.#isDisabled()) {
        return;
      }

      this.#dragDepth += event.type === 'dragenter' ? 1 : 0;
      this.setAttribute('data-dragging', '');

      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
    }

    #onDragLeave(event) {
      event.preventDefault();
      this.#dragDepth = Math.max(0, this.#dragDepth - 1);

      if (this.#dragDepth === 0) {
        this.removeAttribute('data-dragging');
      }
    }

    #onDrop(event) {
      event.preventDefault();
      this.#dragDepth = 0;
      this.removeAttribute('data-dragging');

      if (this.#isDisabled()) {
        this.#reject(null, 'disabled');
        return;
      }

      this.#addFiles(Array.from(event.dataTransfer?.files || []));
    }

    #addFiles(files) {
      if (!files.length) {
        return [];
      }

      if (this.#isDisabled()) {
        const rejected = files.map(file => this.#reject(file, 'disabled'));
        this.#emitChange({ rejected });
        return [];
      }

      const added = [];
      const rejected = [];
      const available = this.#availableSlots();
      const incoming = this.#input.multiple ? files : files.slice(0, 1);

      if (!this.#input.multiple && this.#items.length) {
        this.#items.forEach(item => this.#revoke(item));
        this.#items = [];
      }

      incoming.forEach(file => {
        if (added.length >= available) {
          rejected.push(this.#reject(file, 'count'));
          return;
        }

        const error = this.#validate(file);
        if (error) {
          rejected.push(this.#reject(file, error));
          return;
        }

        const item = this.#createItem(file);
        this.#items.push(item);
        added.push(file);
      });

      if (files.length > incoming.length) {
        files.slice(incoming.length).forEach(file => rejected.push(this.#reject(file, 'count')));
      }

      this.#syncInput();
      this.#render();
      this.#emitChange({ added, rejected });
      return added;
    }

    #createItem(file) {
      const item = {
        id: `upload-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        url: null,
        progress: null
      };

      if (file.type?.startsWith('image/') && URL.createObjectURL) {
        item.url = URL.createObjectURL(file);
      }

      return item;
    }

    #validate(file) {
      if (this.#maxSize() && file.size > this.#maxSize()) {
        return 'size';
      }

      if (!this.#matchesAccept(file)) {
        return 'type';
      }

      return null;
    }

    #matchesAccept(file) {
      const accept = this.#input.getAttribute('accept') || this.getAttribute('accept') || '';
      const parts = accept.split(',').map(part => part.trim().toLowerCase()).filter(Boolean);

      if (!parts.length) {
        return true;
      }

      const name = file.name.toLowerCase();
      const type = (file.type || '').toLowerCase();

      return parts.some(part => {
        if (part.startsWith('.')) {
          return name.endsWith(part);
        }

        if (part.endsWith('/*')) {
          return type.startsWith(part.slice(0, -1));
        }

        return type === part;
      });
    }

    #availableSlots() {
      const max = this.#maxFiles();
      if (!this.#input.multiple) {
        return 1;
      }

      return Number.isFinite(max) ? Math.max(0, max - this.#items.length) : Number.POSITIVE_INFINITY;
    }

    #maxFiles() {
      const raw = this.getAttribute('max-files');
      const max = Number.parseInt(raw, 10);
      return Number.isFinite(max) && max > 0 ? max : Number.POSITIVE_INFINITY;
    }

    #maxSize() {
      const raw = this.getAttribute('max-size');
      const max = Number.parseInt(raw, 10);
      return Number.isFinite(max) && max > 0 ? max : 0;
    }

    #render() {
      this.#syncDisabled();
      this.#list.innerHTML = '';
      this.#items.forEach(item => this.#list.appendChild(this.#renderItem(item)));

      if (this.#list) {
        this.#list.hidden = this.#items.length === 0;
      }

      if (this.#status) {
        this.#status.value = String(this.#items.length);
        this.#status.textContent = this.#statusText();
      }
    }

    #renderItem(item) {
      const li = document.createElement('li');
      li.setAttribute('data-upload-item', '');
      li.setAttribute('data-upload-id', item.id);

      const preview = item.url ? document.createElement('img') : document.createElement('span');
      if (item.url) {
        preview.src = item.url;
        preview.alt = '';
        preview.setAttribute('data-upload-thumb', '');
      } else {
        preview.textContent = this.#extension(item.file);
        preview.setAttribute('data-upload-file-icon', '');
        preview.setAttribute('aria-hidden', 'true');
      }

      const details = document.createElement('span');
      const nameEl = document.createElement('span');
      const metaEl = document.createElement('span');
      details.className = 'vstack gap-1';
      nameEl.setAttribute('data-upload-name', '');
      metaEl.setAttribute('data-upload-meta', '');
      nameEl.textContent = item.file.name;
      metaEl.textContent = `${this.#formatSize(item.file.size)}${item.file.type ? ` / ${item.file.type}` : ''}`;
      details.append(nameEl, metaEl);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ghost small icon';
      remove.setAttribute('data-upload-remove', '');
      remove.setAttribute('aria-label', `Remove ${item.file.name}`);
      remove.textContent = 'x';

      const progress = document.createElement('progress');
      progress.setAttribute('data-upload-item-progress', '');
      progress.max = 100;
      progress.value = 0;
      progress.hidden = true;
      item.progress = progress;

      li.append(preview, details, remove, progress);
      return li;
    }

    #reject(file, reason) {
      const detail = {
        file,
        reason,
        message: this.#message(file, reason)
      };

      if (this.#error) {
        this.#error.value = reason;
        this.#error.textContent = detail.message;
      }

      this.dispatchEvent(new CustomEvent('ot-upload-error', {
        bubbles: true,
        composed: true,
        detail
      }));

      return detail;
    }

    #message(file, reason) {
      if (reason === 'size') {
        return `${file.name} is larger than ${this.#formatSize(this.#maxSize())}.`;
      }

      if (reason === 'type') {
        return `${file.name} is not an accepted file type.`;
      }

      if (reason === 'count') {
        return `Only ${this.#maxFiles() === Number.POSITIVE_INFINITY ? 1 : this.#maxFiles()} file${this.#maxFiles() === 1 ? '' : 's'} can be selected.`;
      }

      return messages[reason] || 'File could not be added.';
    }

    #emitChange(detail = {}) {
      const next = {
        files: this.files,
        added: [],
        removed: [],
        rejected: [],
        ...detail
      };

      this.dispatchEvent(new CustomEvent('ot-upload-change', {
        bubbles: true,
        composed: true,
        detail: next
      }));
    }

    #syncInput() {
      if (!window.DataTransfer) {
        return;
      }

      try {
        const transfer = new DataTransfer();
        this.#items.forEach(item => transfer.items.add(item.file));
        this.#input.files = transfer.files;
      } catch {
        this.#clearNativeInput(false);
      }
    }

    #clearNativeInput(force = true) {
      try {
        this.#input.value = '';
        if (force && window.DataTransfer) {
          this.#input.files = new DataTransfer().files;
        }
      } catch {
        // Some browsers treat file inputs as write-protected. The selected list remains the source of truth.
      }
    }

    #syncDisabled() {
      const disabled = this.#isDisabled();
      this.toggleAttribute('data-disabled', disabled);
      this.#dropzone?.setAttribute('aria-disabled', String(disabled));

      if (!this.#dropzone?.matches('label')) {
        this.#dropzone.tabIndex = disabled ? -1 : 0;
        this.#dropzone.setAttribute('role', 'button');
      }
    }

    #isDisabled() {
      return this.hasAttribute('disabled') || this.#input?.disabled;
    }

    #findIndex(target) {
      if (typeof target === 'number') {
        return target >= 0 && target < this.#items.length ? target : -1;
      }

      return this.#items.findIndex(item => item.id === target || item.file === target);
    }

    #findItem(target) {
      return this.#items[this.#findIndex(target)];
    }

    #revoke(item) {
      if (item?.url && URL.revokeObjectURL) {
        URL.revokeObjectURL(item.url);
      }
    }

    #hintText() {
      const bits = [];
      const accept = this.#input.getAttribute('accept') || this.getAttribute('accept');
      if (accept) {
        bits.push(accept);
      }
      if (this.#maxSize()) {
        bits.push(`up to ${this.#formatSize(this.#maxSize())}`);
      }
      if (this.#maxFiles() !== Number.POSITIVE_INFINITY) {
        bits.push(`${this.#maxFiles()} max`);
      }
      return bits.length ? bits.join(' / ') : 'Files stay in your browser until the form is submitted.';
    }

    #statusText() {
      const count = this.#items.length;
      if (count === 0) {
        return 'No files selected';
      }
      return count === 1 ? '1 file selected' : `${count} files selected`;
    }

    #extension(file) {
      const ext = file.name.includes('.') ? file.name.split('.').pop() : 'file';
      return ext.slice(0, 4);
    }

    #formatSize(bytes) {
      if (!bytes) {
        return '0 B';
      }

      const units = ['B', 'KB', 'MB', 'GB'];
      const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
      const value = bytes / 1024 ** index;
      return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
    }
  }

  customElements.define(name, OtUpload);
})();