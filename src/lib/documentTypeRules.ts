// Regras de upload de documentos (Gestão Documental). Formato é função pura (testada
// aqui e usada no fileFilter do multer). Tamanho é constante (limits do multer).
// Tipo-ativo é checado no handler (depende do banco).

export const DOC_MAX_BYTES = 20 * 1024 * 1024; // 20 MB
export const DOC_ACCEPTED_EXT = ['pdf', 'jpg', 'jpeg', 'png', 'docx'] as const;

// Aceita pela EXTENSÃO do nome do arquivo (último ponto). Case-insensitive.
export function isAcceptedDocFormat(filename: string): boolean {
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return false;
  const ext = filename.slice(dot + 1).toLowerCase();
  return (DOC_ACCEPTED_EXT as readonly string[]).includes(ext);
}
