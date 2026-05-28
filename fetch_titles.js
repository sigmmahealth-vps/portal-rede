import https from 'https';

const links = [
  "https://drive.google.com/file/d/1suKg8ulqBU5E5w5jza1Nu2jsqNMYXPgd/view?usp=sharing",
  "https://drive.google.com/file/d/1B7a-NCN8jhMXKYGibcycDyUQQN23QoX8/view?usp=drive_link",
  "https://drive.google.com/file/d/114rc_2TpJIMYsX8Nq2MvS8bxDmVOqJsl/view?usp=drive_link",
  "https://drive.google.com/file/d/1qNhBYx9BVnW5SzxMzwotdEjIC92Wkxou/view?usp=drive_link",
  "https://drive.google.com/file/d/1zZF7fd-67C4x4pDHlsDtW5Et_FfF-uin/view?usp=drive_link",
  "https://drive.google.com/file/d/1DMLTbF1RLT-yVpt4FJAenw0z7nrkds0-/view?usp=drive_link",
  "https://drive.google.com/file/d/14qQR9QHbn7APBmrUfvb1xXsjblWtmQ84/view?usp=drive_link",
  "https://drive.google.com/file/d/1rOAtalRTmQoLskpM121qEhLQFTYvEHlO/view?usp=drive_link",
  "https://drive.google.com/file/d/1gD3SPtG1wDXuScwaTz90eO9gHLar-4nO/view?usp=drive_link",
  "https://drive.google.com/file/d/1bAEwqApsOTkqWzozpc_L4QbeMI8Z345s/view?usp=drive_link",
  "https://drive.google.com/file/d/1-E_Umfo43sTJNJoxEu-g32GOrWfPlJxB/view?usp=drive_link",
  "https://drive.google.com/file/d/16NEG2tKBzVqS1qcVxqV9PoH38uZHhs6U/view?usp=drive_link",
  "https://drive.google.com/file/d/10CtbwMALqbdMop8KEj1RWLHm0WqOB0GP/view?usp=drive_link",
  "https://drive.google.com/file/d/1ndikGjrANvp7bYX21_jksy76GCPBV3sE/view?usp=drive_link",
  "https://drive.google.com/file/d/1WCe01avJrG7ontnuIZpno2pl8onU2Fyx/view?usp=drive_link",
  "https://drive.google.com/file/d/1psn_X75ply6X5oQBYTyoEqeVR6GeEnsg/view?usp=drive_link",
  "https://drive.google.com/file/d/1ewn-N8tONmZpH43WdDe9wO2SnVKc0Fi4/view?usp=drive_link",
  "https://drive.google.com/file/d/1TqRCHPqjIyD4OQlZCUeLkh8ED4Webai0/view?usp=drive_link",
  "https://drive.google.com/file/d/1AabkkhLmBiO8Pz1Sc6__5Lr3r1JNv_Sk/view?usp=drive_link",
  "https://drive.google.com/file/d/1GMEu_u58ZnCwAT633_me9lp0-iIEutBN/view?usp=drive_link",
  "https://drive.google.com/file/d/1HuKEfPHqIf1Z-fr3VBK7AHeo90YGDALJ/view?usp=drive_link",
  "https://drive.google.com/file/d/1os7FqgTdEmmbeFvgmlKqW4lAZkr7dCUu/view?usp=drive_link",
  "https://drive.google.com/file/d/1zFLOgkiyFMALEDENdYNJXRR0j4-iPVwl/view?usp=drive_link",
  "https://drive.google.com/file/d/1-zc81cgFgDn5ZPctA_ybhTyc6NotKd6D/view?usp=drive_link",
  "https://drive.google.com/file/d/1mEURS9U6BVEjP-a4CVjD7R6MZ_m-Y61c/view?usp=drive_link",
  "https://drive.google.com/file/d/1onHAKNimRcCpQpPEdK1SSfjjjDSzpt5_/view?usp=drive_link"
];

async function fetchTitle(url) {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const match = data.match(/<title>(.*?)<\/title>/);
        if (match) {
          resolve({ url, title: match[1] });
        } else {
          resolve({ url, title: 'No title' });
        }
      });
    }).on('error', () => resolve({ url, title: 'Error' }));
  });
}

async function main() {
  for (const link of links) {
    const res = await fetchTitle(link);
    console.log(res.title, res.url);
  }
}

main();
