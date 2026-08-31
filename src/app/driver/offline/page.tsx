import { CloudOff } from "lucide-react";
import Link from "next/link";

// Página servida pelo service worker quando o motorista abre uma tela que
// ainda não foi visitada e não há conexão.
export default function DriverOfflinePage() {
  return (
    <div className="bg-white rounded-2xl p-8 text-center shadow-sm mt-4">
      <CloudOff className="w-12 h-12 text-gray-300 mx-auto mb-4" />
      <h1 className="font-outfit font-bold text-lg text-gray-900 mb-2">Sem conexão</h1>
      <p className="text-gray-500 text-sm mb-6">
        Esta tela ainda não estava salva no aparelho. As baixas que você registrar
        continuam guardadas e sobem sozinhas quando o sinal voltar.
      </p>
      <Link
        href="/driver"
        className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl bg-blue-600 text-white font-medium"
      >
        Voltar para as viagens
      </Link>
    </div>
  );
}
