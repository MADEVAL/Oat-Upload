const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.resolve(__dirname, '../src/upload.js'), 'utf8');

function setup(body) {
  const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, {
    pretendToBeVisual: true,
    runScripts: 'dangerously',
    url: 'https://example.test/'
  });

  dom.window.console.warn = () => {};
  dom.window.URL.createObjectURL = file => `blob:${file.name}`;
  dom.window.URL.revokeObjectURL = () => {};
  dom.window.eval(source);
  return dom;
}

function file(window, name, type, size = 4) {
  return new window.File(['x'.repeat(size)], name, { type });
}

function inputFiles(window, input, files) {
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: files
  });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
}

function dropFiles(window, target, files) {
  const event = new window.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { files, dropEffect: 'none' }
  });
  target.dispatchEvent(event);
}

function click(window, element) {
  element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}

function names(document) {
  return Array.from(document.querySelectorAll('[data-upload-name]')).map(el => el.textContent);
}

test('enhances a minimal native file input', () => {
  const dom = setup('<ot-upload><input type="file" name="files" multiple></ot-upload>');
  const { document } = dom.window;
  const upload = document.querySelector('ot-upload');

  assert.equal(upload.hasAttribute('data-enhanced'), true);
  assert.ok(document.querySelector('[data-upload-dropzone]'));
  assert.ok(document.querySelector('[data-upload-list]'));
  assert.ok(document.querySelector('[data-upload-status]'));
  assert.ok(document.querySelector('progress[data-upload-progress]'));
  assert.equal(document.querySelector('[data-upload-status]').textContent, 'No files selected');
});

test('adds files from input, renders previews, and emits change', () => {
  const dom = setup('<ot-upload><input type="file" multiple accept="image/*,.pdf"></ot-upload>');
  const { document } = dom.window;
  const upload = document.querySelector('ot-upload');
  const input = document.querySelector('input');
  const events = [];

  upload.addEventListener('ot-upload-change', event => events.push(event.detail));

  inputFiles(dom.window, input, [
    file(dom.window, 'avatar.png', 'image/png'),
    file(dom.window, 'brief.pdf', 'application/pdf')
  ]);

  assert.deepEqual(names(document), ['avatar.png', 'brief.pdf']);
  assert.equal(upload.files.length, 2);
  assert.equal(events.length, 1);
  assert.equal(events[0].added.length, 2);
  assert.equal(document.querySelector('[data-upload-thumb]').getAttribute('src'), 'blob:avatar.png');
  assert.equal(document.querySelector('[data-upload-status]').textContent, '2 files selected');
});

test('validates file type and max size with error events', () => {
  const dom = setup('<ot-upload accept="image/*" max-size="5"><input type="file" multiple></ot-upload>');
  const { document } = dom.window;
  const upload = document.querySelector('ot-upload');
  const errors = [];
  const changes = [];

  upload.addEventListener('ot-upload-error', event => errors.push(event.detail));
  upload.addEventListener('ot-upload-change', event => changes.push(event.detail));

  upload.addFiles([
    file(dom.window, 'ok.png', 'image/png', 4),
    file(dom.window, 'large.png', 'image/png', 10),
    file(dom.window, 'notes.txt', 'text/plain', 2)
  ]);

  assert.deepEqual(names(document), ['ok.png']);
  assert.equal(errors.length, 2);
  assert.deepEqual(errors.map(error => error.reason), ['size', 'type']);
  assert.equal(changes[0].rejected.length, 2);
  assert.match(document.querySelector('[data-upload-error]').textContent, /not an accepted file type/);
});

test('adds files from drag and drop and clears dragging state', () => {
  const dom = setup('<ot-upload><input type="file" multiple></ot-upload>');
  const { document } = dom.window;
  const upload = document.querySelector('ot-upload');
  const dropzone = document.querySelector('[data-upload-dropzone]');

  const drag = new dom.window.Event('dragenter', { bubbles: true, cancelable: true });
  Object.defineProperty(drag, 'dataTransfer', { value: { dropEffect: 'none' } });
  dropzone.dispatchEvent(drag);
  assert.equal(upload.hasAttribute('data-dragging'), true);

  dropFiles(dom.window, dropzone, [file(dom.window, 'drop.pdf', 'application/pdf')]);

  assert.equal(upload.hasAttribute('data-dragging'), false);
  assert.deepEqual(names(document), ['drop.pdf']);
});

test('remove and clear update previews and emit removed files', () => {
  const dom = setup('<ot-upload><input type="file" multiple></ot-upload>');
  const { document } = dom.window;
  const upload = document.querySelector('ot-upload');
  const events = [];

  upload.addEventListener('ot-upload-change', event => events.push(event.detail));
  upload.addFiles([
    file(dom.window, 'one.pdf', 'application/pdf'),
    file(dom.window, 'two.pdf', 'application/pdf')
  ]);

  click(dom.window, document.querySelector('[data-upload-remove]'));
  assert.deepEqual(names(document), ['two.pdf']);
  assert.equal(events.at(-1).removed[0].name, 'one.pdf');

  upload.clear();
  assert.deepEqual(names(document), []);
  assert.equal(upload.files.length, 0);
  assert.equal(events.at(-1).removed[0].name, 'two.pdf');
  assert.equal(document.querySelector('[data-upload-status]').textContent, 'No files selected');
});

test('respects max-files and single-file inputs', () => {
  const dom = setup('<ot-upload max-files="2"><input type="file" multiple></ot-upload>');
  const upload = dom.window.document.querySelector('ot-upload');
  const errors = [];
  upload.addEventListener('ot-upload-error', event => errors.push(event.detail));

  upload.addFiles([
    file(dom.window, 'a.pdf', 'application/pdf'),
    file(dom.window, 'b.pdf', 'application/pdf'),
    file(dom.window, 'c.pdf', 'application/pdf')
  ]);

  assert.deepEqual(Array.from(upload.files, item => item.name), ['a.pdf', 'b.pdf']);
  assert.equal(errors.at(-1).reason, 'count');

  const single = setup('<ot-upload><input type="file"></ot-upload>');
  const singleUpload = single.window.document.querySelector('ot-upload');
  singleUpload.addFiles([file(single.window, 'first.pdf', 'application/pdf')]);
  singleUpload.addFiles([file(single.window, 'second.pdf', 'application/pdf')]);

  assert.deepEqual(Array.from(singleUpload.files, item => item.name), ['second.pdf']);
});

test('progress API uses native progress elements', () => {
  const dom = setup('<ot-upload><input type="file" multiple></ot-upload>');
  const { document } = dom.window;
  const upload = document.querySelector('ot-upload');
  upload.addFiles([file(dom.window, 'asset.pdf', 'application/pdf')]);

  const progress = document.querySelector('[data-upload-progress]');
  upload.setProgress(64);
  assert.equal(progress.hidden, false);
  assert.equal(progress.value, 64);

  const currentFile = upload.files[0];
  upload.setProgress(25, currentFile);
  assert.equal(document.querySelector('[data-upload-item-progress]').hidden, false);
  assert.equal(document.querySelector('[data-upload-item-progress]').value, 25);

  upload.resetProgress();
  assert.equal(progress.hidden, true);
});

test('disabled upload rejects input and drop operations', () => {
  const dom = setup('<ot-upload disabled><input type="file" multiple></ot-upload>');
  const { document } = dom.window;
  const upload = document.querySelector('ot-upload');
  const errors = [];

  upload.addEventListener('ot-upload-error', event => errors.push(event.detail));
  upload.addFiles([file(dom.window, 'blocked.pdf', 'application/pdf')]);

  assert.equal(upload.hasAttribute('data-disabled'), true);
  assert.equal(upload.files.length, 0);
  assert.equal(errors[0].reason, 'disabled');

  dropFiles(dom.window, document.querySelector('[data-upload-dropzone]'), [file(dom.window, 'also-blocked.pdf', 'application/pdf')]);
  assert.equal(upload.files.length, 0);
  assert.equal(errors.at(-1).reason, 'disabled');
});

test('custom parts are preserved', () => {
  const dom = setup(`
    <ot-upload>
      <input id="custom-file" type="file" multiple>
      <label data-upload-dropzone for="custom-file"><strong>Custom dropzone</strong></label>
      <ol data-upload-list></ol>
      <output data-upload-status></output>
      <output data-upload-error></output>
      <progress data-upload-progress></progress>
    </ot-upload>
  `);

  const { document } = dom.window;
  assert.equal(document.querySelector('[data-upload-dropzone] strong').textContent, 'Custom dropzone');
  assert.equal(document.querySelectorAll('[data-upload-list]').length, 1);
  assert.equal(document.querySelector('[data-upload-list]').tagName, 'OL');
});