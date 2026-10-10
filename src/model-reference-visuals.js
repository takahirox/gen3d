import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Transformer } from '@napi-rs/image';

export const referenceViews = ['minus-y', 'plus-x', 'plus-y', 'minus-x', 'plus-z', 'minus-z', 'three-quarter-a', 'three-quarter-b'];
export const maxVisualReferences = 32;
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

export async function referenceSheet(model, views, directory) {
  if (!Array.isArray(views) || views.length !== referenceViews.length || referenceViews.some(view => views.filter(v => v.view === view).length !== 1)) throw new Error(`${model.name}: incomplete 3D reference renders`);
  const width = 1536, height = 884, tile = 384;
  const title = `${model.assetId} · ${model.permission} · ${model.name.slice(0, 72)}`;
  const labels = views.map((v, i) => `<text x="${i % 4 * tile + 8}" y="${Math.floor(i / 4) * 410 + 75}" font-size="18">${escape(v.view)}</text>`).join('');
  const canvas = Transformer.fromSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#eef0f4"/><g fill="#111"><text x="8" y="23" font-size="18">${escape(title)}</text><text x="8" y="48" font-size="18">Role: ${escape((model.role || 'general shape/style').slice(0, 140))}</text>${labels}</g></svg>`).resize(width, height);
  let visible = false;
  for (const [i, view] of views.entries()) {
    if (view.image !== view.view + '.png' || !Array.isArray(view.direction) || view.direction.length !== 3 || view.direction.some(v => !Number.isFinite(v)) || Math.hypot(...view.direction) < .01
      || !Array.isArray(view.center) || view.center.length !== 3 || view.center.some(v => !Number.isFinite(v)) || !Number.isFinite(view.orthoScale) || view.orthoScale <= 0 || view.projection !== 'orthographic') throw new Error(`${model.name}: invalid reference camera ${view.view}`);
    const file = path.join(directory, view.image);
    const image = new Transformer(fs.readFileSync(file));
    const metadata = image.metadataSync();
    if (metadata.width !== tile || metadata.height !== tile || !fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) throw new Error(`${model.name}: invalid reference image ${view.view}`);
    const pixels = image.rawPixelsSync(), channels = pixels.length / (tile * tile);
    if (!Number.isInteger(channels) || channels < 3 || channels > 4) throw new Error(`${model.name}: invalid reference pixel format ${view.view}`);
    const low = [255, 255, 255], high = [0, 0, 0];
    for (let offset = 0; offset < pixels.length; offset += channels) for (let channel = 0; channel < 3; channel++) {
      low[channel] = Math.min(low[channel], pixels[offset + channel]); high[channel] = Math.max(high[channel], pixels[offset + channel]);
    }
    visible ||= high.some((value, channel) => value - low[channel] > 8);
    canvas.overlay(fs.readFileSync(file), i % 4 * tile, Math.floor(i / 4) * 410 + 84);
    view.sha256 = hash(file);
  }
  if (!visible) throw new Error(`${model.name}: all reference views are blank or visually unobservable; check visibility, materials and geometry`);
  const sheet = path.join(directory, 'contact-sheet.png');
  fs.writeFileSync(sheet, await canvas.png());
  return { assetId: model.assetId, name: model.name, role: model.role, permission: model.permission, sha256: model.sha256,
    sheet, sheetSha256: hash(sheet), views: views.map(v => ({ ...v, image: path.join(directory, v.image) })) };
}

export function referenceDecisions(models, audit, reused) {
  return models.map(model => {
    const decisions = audit.filter(e => e.tool === 'choose_reference_usage' && e.assetId === model.assetId);
    const decision = decisions.at(-1);
    if (!decision || !['reuse', 'visual-only'].includes(decision.usage) || typeof decision.reason !== 'string' || !decision.reason.trim()) throw new Error(`Missing suitability decision for 3D reference: ${model.name}`);
    const objects = reused.filter(o => o.assetId === model.assetId);
    if (objects.some(o => typeof o.objectName !== 'string' || !o.objectName || typeof o.targetObject !== 'string' || !o.targetObject || o.method !== 'reuse_reference_mesh' || o.sha256 !== model.sha256)) throw new Error(`Invalid reference object provenance: ${model.name}`);
    if (decision.usage === 'reuse' && (model.permission !== 'reuse-edit' || !objects.length)) throw new Error(`Reference reuse decision has no permitted surviving geometry: ${model.name}`);
    if (decision.usage === 'visual-only' && objects.length) throw new Error(`Visual-only decision contradicts reused geometry: ${model.name}`);
    return { assetId: model.assetId, role: model.role, permission: model.permission, sha256: model.sha256, usage: decision.usage, reason: decision.reason, objects };
  });
}
