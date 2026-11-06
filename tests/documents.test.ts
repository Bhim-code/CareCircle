import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_FILE_BYTES, canDelete, describeDocumentError, fileSummary, formatSize, kindOfFile, validateUpload } from '../src/application/documents';
import type { HealthRecord, PickedFile } from '../src/domain/entities/HealthRecord';
import { ApiError } from '../src/infrastructure/http/ApiError';

const NOW = new Date(2026, 10, 6, 10, 0);
const photo: PickedFile = { uri: 'file:///a.jpg', name: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 500_000 };
const pdf: PickedFile = { uri: 'file:///b.pdf', name: 'b.pdf', mimeType: 'application/pdf', sizeBytes: 2_000_000 };
const draft = { title: 'Blood test', category: 'lab_report' as const, recordedOn: '2026-10-29', file: pdf };

describe('kindOfFile', () => {
  it('knows PDFs and the allowed photos', () => {
    assert.equal(kindOfFile(pdf), 'pdf');
    assert.equal(kindOfFile(photo), 'image');
    assert.equal(kindOfFile({ name: 'x.heic', mimeType: 'image/heic' }), 'image');
    assert.equal(kindOfFile({ name: 'x.png', mimeType: 'image/png' }), 'image');
  });
  it('falls back on the ending when the phone gives no type', () => {
    assert.equal(kindOfFile({ name: 'scan.PDF', mimeType: null }), 'pdf');
    assert.equal(kindOfFile({ name: 'p.HEIC', mimeType: 'application/octet-stream' }), 'image');
  });
  it('refuses other files', () => {
    assert.equal(kindOfFile({ name: 'a.docx', mimeType: 'application/msword' }), null);
    assert.equal(kindOfFile({ name: 'a.gif', mimeType: 'image/gif' }), null);
    assert.equal(kindOfFile({ name: 'noending', mimeType: null }), null);
  });
});

describe('formatSize and fileSummary', () => {
  it('writes sizes simply', () => {
    assert.equal(formatSize(900), '900 B');
    assert.equal(formatSize(850 * 1024), '850 KB');
    assert.equal(formatSize(2.3 * 1024 * 1024), '2.3 MB');
  });
  it('summarises a document', () => {
    const base: HealthRecord = { id: '1', title: 't', category: 'other', recordedOn: null };
    assert.equal(fileSummary(base), 'Details only');
    assert.equal(fileSummary({ ...base, fileType: 'pdf', sizeBytes: 2 * 1024 * 1024 }), 'PDF · 2.0 MB');
    assert.equal(fileSummary({ ...base, fileType: 'image' }), 'Photo');
  });
});

describe('validateUpload', () => {
  it('accepts a good form and trims the title', () => {
    const result = validateUpload({ ...draft, title: '  Blood test ' }, NOW);
    assert.ok(result.ok);
    assert.equal(result.input.title, 'Blood test');
    assert.equal(result.input.recordedOn, '2026-10-29');
    assert.equal(result.input.patientId, undefined);
  });
  it('allows no date', () => {
    const result = validateUpload({ ...draft, recordedOn: '' }, NOW);
    assert.ok(result.ok);
    assert.equal(result.input.recordedOn, null);
  });
  it('asks for what is missing', () => {
    const result = validateUpload({ title: ' ', category: '', recordedOn: '', file: null }, NOW);
    assert.ok(!result.ok);
    assert.ok(result.errors.title && result.errors.category && result.errors.file);
  });
  it('refuses a future or unreadable date', () => {
    const future = validateUpload({ ...draft, recordedOn: '2026-11-07' }, NOW);
    assert.ok(!future.ok && future.errors.recordedOn);
    const odd = validateUpload({ ...draft, recordedOn: 'yesterday' }, NOW);
    assert.ok(!odd.ok && odd.errors.recordedOn);
    assert.ok(validateUpload({ ...draft, recordedOn: '2026-11-06' }, NOW).ok);
  });
  it('refuses a file that is too big or the wrong kind', () => {
    const big = validateUpload({ ...draft, file: { ...pdf, sizeBytes: MAX_FILE_BYTES + 1 } }, NOW);
    assert.ok(!big.ok && big.errors.file?.includes('10 MB'));
    assert.ok(validateUpload({ ...draft, file: { ...pdf, sizeBytes: MAX_FILE_BYTES } }, NOW).ok);
    const wrong = validateUpload({ ...draft, file: { uri: 'x', name: 'a.doc', mimeType: 'application/msword', sizeBytes: 5 } }, NOW);
    assert.ok(!wrong.ok && wrong.errors.file);
  });
  it('accepts a file of unknown size (the backend still checks)', () => {
    assert.ok(validateUpload({ ...draft, file: { ...pdf, sizeBytes: null } }, NOW).ok);
  });
  it('needs a client only when asked to', () => {
    const missing = validateUpload(draft, NOW, true);
    assert.ok(!missing.ok && missing.errors.patientId);
    const chosen = validateUpload({ ...draft, patientId: 'p-1' }, NOW, true);
    assert.ok(chosen.ok);
    assert.equal(chosen.input.patientId, 'p-1');
  });
});

describe('canDelete', () => {
  const record: HealthRecord = { id: '1', title: 't', category: 'other', recordedOn: null, patientId: 'p-1', uploadedBy: { id: 'c-1', name: 'Sam' } };
  it('lets the patient and the uploader delete', () => {
    assert.ok(canDelete(record, 'p-1'));
    assert.ok(canDelete(record, 'c-1'));
    assert.ok(!canDelete(record, 'other'));
  });
});

describe('describeDocumentError', () => {
  it('speaks plainly about each failure', () => {
    assert.match(describeDocumentError(new ApiError(0, 'network', 'x')), /connection/);
    assert.match(describeDocumentError(new ApiError(413, 'payload_too_large', 'x')), /10 MB/);
    assert.equal(describeDocumentError(new ApiError(415, 'unsupported', 'Only PDF.', { fields: { file: 'Only PDF, JPEG, PNG or HEIC.' } })), 'Only PDF, JPEG, PNG or HEIC.');
    assert.match(describeDocumentError(new ApiError(403, 'missing_permission', 'x')), /not allowed/);
    assert.match(describeDocumentError(new ApiError(429, 'too_many_requests', 'x')), /Too many/);
    assert.match(describeDocumentError(new ApiError(404, 'not_found', 'x')), /no longer/);
    assert.match(describeDocumentError(new Error('boom')), /try again/);
  });
});
