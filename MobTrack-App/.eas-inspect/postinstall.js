const fs = require('fs');
const path = require('path');

const filesToPatch = [
  'node_modules/expo-dev-launcher/expo-dev-launcher-gradle-plugin/build.gradle.kts',
  'node_modules/expo-modules-autolinking/android/expo-gradle-plugin/expo-autolinking-plugin-shared/build.gradle.kts'
];

filesToPatch.forEach(file => {
  const fullPath = path.join(__dirname, file);
  if (fs.existsSync(fullPath)) {
    let content = fs.readFileSync(fullPath, 'utf8');
    if (content.includes('1.9.24')) {
      content = content.replace(/1\.9\.24/g, '2.1.0');
      fs.writeFileSync(fullPath, content, 'utf8');
      console.log(`Patched Kotlin version in ${file}`);
    }
  } else {
    console.warn(`Could not find ${file} to patch`);
  }
});
