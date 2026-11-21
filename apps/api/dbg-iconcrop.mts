import sharp from 'sharp';

// Crop the custom-rows band (rows start after the Adults row). At 200dpi,
// Price Breakdown heading ~y=467*2.78; rows at 65pt pitch from 512pt.
const S = 200 / 72;
const img = sharp('../../tmp/footer-verify/iv2-2.png');
const meta = await img.metadata();
console.log('page size:', meta.width, 'x', meta.height);
// Rows region: from the traveller rows through the card bottom.
const top = Math.round(1350 * (200 / 595.28));
const img2 = sharp('../../tmp/footer-verify/iv2-2.png');
await img2.extract({ left: 0, top, width: 1654, height: 2339 - top }).toFile('../../tmp/footer-verify/iv-rows.png');
console.log('rows crop saved');
