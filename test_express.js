import express from 'express';
import multer from 'multer';

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.json());

app.post('/test', upload.single('file'), (req, res) => {
  console.log('Body:', Object.keys(req.body));
  console.log('File:', req.file);
  res.json({ ok: true, body: req.body });
});

const server = app.listen(3002, async () => {
  try {
    const form = new FormData();
    form.append('name', 'Test');
    form.append('email', 'test@test.com');
    form.append('phone', '1234');
    form.append('specialty', 'Clinica');

    const res = await fetch('http://localhost:3002/test', {
      method: 'POST',
      body: form 
    });
    console.log('Test FormData:', await res.json());

    // Test with JSON
    const res2 = await fetch('http://localhost:3002/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Json Test' })
    });
    console.log('Test JSON:', await res2.json());

  } finally {
    server.close();
  }
});
