import fetch from 'node-fetch';
import FormData from 'form-data';

async function test() {
  const form = new FormData();
  form.append('name', 'Test Clinic');
  form.append('email', 'test@test.com');
  form.append('phone', '1234');
  form.append('specialty', 'Clinica');

  try {
    const res = await fetch('http://localhost:3000/api/credentialing-requests', {
      method: 'POST',
      body: form
    });
    const text = await res.text();
    console.log(res.status, text);
  } catch (e) {
    console.error(e);
  }
}
test();
