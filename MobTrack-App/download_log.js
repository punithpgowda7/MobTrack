const https = require('https');
const fs = require('fs');
const zlib = require('zlib');

const url = "https://storage.googleapis.com/eas-workflows-production/logs/db381ab8-29cc-4a17-a93f-ecb624ee79ed/0f954d3b-24fc-4ae6-af5b-d27146eaf1c6/2026-08-15T19%3A54%3A14Z-af6838f2-1f05-480d-a7ed-88104added23.txt?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Credential=www-production%40exponentjs.iam.gserviceaccount.com%2F20260815%2Fauto%2Fstorage%2Fgoog4_request&X-Goog-Date=20260815T201034Z&X-Goog-Expires=900&X-Goog-SignedHeaders=host&X-Goog-Signature=a37c54a44a1a36b2ff0c586cad33589829f70f21e81be7a4197db6ec024c32eb45c3e340b43fd383bf9bd3e2bbf15700eb3ac3afe07319b2481ebb11b542b6a75b4edf6b1e93c1822be22aac609440c8adc9aaf6fc6ea29496ce8e30c6dac77a3f7c8e63b33489347375a770bf8cb24de9f382d98505c1cb2e2817382021650ec1452ebc0620ee9ea1dcfd19667de532823d1a60a56c2ee67fa848aade26e64d02ac844a2d726a005ebfdfd94351d444afdc489fe11c98d6007f1624326be8fbc32586986c245f8fab23753aedd2ba0fda22e3477268f9aa5111e4b9df491625917fa59ae3de788e8f8426a92a0fc620699487534e8ca1c3fc4eededfc7c15fc";

https.get(url, (res) => {
  const output = fs.createWriteStream('eas_log_unzipped.jsonl');
  
  if (res.headers['content-encoding'] === 'gzip') {
    res.pipe(zlib.createGunzip()).pipe(output);
  } else {
    // If it's already plain text (some URLs just serve plain text if requested without Accept-Encoding)
    res.pipe(output);
  }

  output.on('finish', () => {
    console.log("Download and decode complete.");
  });
}).on('error', (err) => {
  console.error("Error downloading:", err.message);
});
