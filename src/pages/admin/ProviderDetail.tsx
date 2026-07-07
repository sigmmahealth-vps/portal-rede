import { useParams } from 'react-router-dom';

export default function ProviderDetail() {
  const { id } = useParams();
  return <div className="max-w-7xl mx-auto">Detalhe do prestador {id} (em construção)</div>;
}
