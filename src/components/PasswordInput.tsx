import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

// Input de senha com alternador de visibilidade (olhinho). Aceita as mesmas
// props de um <input>; o type é controlado internamente.
export default function PasswordInput({ className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={show ? 'text' : 'password'} className={`${className} pr-11`} />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}
        title={show ? 'Ocultar senha' : 'Mostrar senha'}
        className="absolute right-3 top-1/2 -translate-y-1/2 rounded text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-[#00995D]/40"
      >
        {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
      </button>
    </div>
  );
}
