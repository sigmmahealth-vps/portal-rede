import https from 'https';
import fs from 'fs';
import path from 'path';

const fonts = [
  { id: '1WCe01avJrG7ontnuIZpno2pl8onU2Fyx', name: 'Unimed-Regular.woff2' },
  { id: '1suKg8ulqBU5E5w5jza1Nu2jsqNMYXPgd', name: 'Unimed-Bold.woff2' }
];

const downloadFile = (url, dest) => {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 303) {
        return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(true);
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
};

async function main() {
  const dir = path.join(process.cwd(), 'public', 'fonts');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  for (const font of fonts) {
    const url = `https://drive.google.com/uc?export=download&id=${font.id}`;
    const dest = path.join(dir, font.name);
    console.log(`Downloading ${font.name}...`);
    await downloadFile(url, dest);
    console.log(`Downloaded ${font.name} successfully.`);
  }
}

main();
