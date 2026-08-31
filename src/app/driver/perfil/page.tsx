"use client";

import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { Loader2, IdCard, Truck, AlertTriangle, LogOut, Phone, Mail } from "lucide-react";
import { daysUntil, formatCalendarDate } from "@/lib/format";

type Perfil = {
  cpf: string;
  cnh: string;
  cnhExpiry: string;
  category: string;
  phone: string | null;
  user: { name: string; email: string };
  vehicles: { plate: string; model: string; type: string; status: string }[];
};

export default function DriverPerfilPage() {
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/driver/perfil")
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => null);
          throw new Error(body?.error ?? "Não foi possível carregar o perfil.");
        }
        return r.json();
      })
      .then(setPerfil)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error || !perfil) {
    return (
      <div className="bg-white rounded-2xl p-6 mt-4 shadow-sm">
        <p className="text-gray-600 text-sm">{error || "Perfil indisponível."}</p>
      </div>
    );
  }

  const dias = daysUntil(perfil.cnhExpiry);
  const cnhVencida = dias < 0;
  const cnhVencendo = dias >= 0 && dias <= 30;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl p-6 shadow-xl shadow-blue-900/5 mt-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xl font-bold shrink-0">
            {perfil.user.name.charAt(0)}
          </div>
          <div className="min-w-0">
            <h1 className="font-outfit font-bold text-lg text-gray-900 truncate">
              {perfil.user.name}
            </h1>
            <p className="text-sm text-gray-500 flex items-center gap-1 truncate">
              <Mail className="w-3.5 h-3.5 shrink-0" /> {perfil.user.email}
            </p>
            {perfil.phone && (
              <p className="text-sm text-gray-500 flex items-center gap-1">
                <Phone className="w-3.5 h-3.5 shrink-0" /> {perfil.phone}
              </p>
            )}
          </div>
        </div>
      </div>

      {(cnhVencida || cnhVencendo) && (
        <div
          className={`rounded-2xl p-4 flex gap-3 ${
            cnhVencida
              ? "bg-red-50 border border-red-200 text-red-800"
              : "bg-amber-50 border border-amber-200 text-amber-800"
          }`}
        >
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium">
              {cnhVencida ? "CNH vencida" : `CNH vence em ${dias} ${dias === 1 ? "dia" : "dias"}`}
            </p>
            <p>Procure a operação para regularizar antes da próxima viagem.</p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl p-6 shadow-sm space-y-4">
        <h2 className="font-bold text-gray-900 flex items-center gap-2">
          <IdCard className="w-5 h-5 text-blue-600" /> Habilitação
        </h2>
        <dl className="space-y-3 text-sm">
          <Linha termo="CPF" valor={perfil.cpf} />
          <Linha termo="CNH" valor={perfil.cnh} />
          <Linha termo="Categoria" valor={perfil.category} />
          <Linha termo="Validade" valor={formatCalendarDate(perfil.cnhExpiry)} />
        </dl>
      </div>

      <div className="bg-white rounded-2xl p-6 shadow-sm space-y-4">
        <h2 className="font-bold text-gray-900 flex items-center gap-2">
          <Truck className="w-5 h-5 text-blue-600" /> Veículos vinculados
        </h2>
        {perfil.vehicles.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhum veículo vinculado ao seu cadastro.</p>
        ) : (
          <ul className="space-y-3">
            {perfil.vehicles.map((v) => (
              <li key={v.plate} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900">{v.plate}</p>
                  <p className="text-sm text-gray-500 truncate">
                    {v.model} · {v.type}
                  </p>
                </div>
                <span className="text-xs px-3 py-1.5 rounded-full bg-gray-100 text-gray-600 whitespace-nowrap">
                  {v.status === "ON_ROUTE"
                    ? "Em rota"
                    : v.status === "MAINTENANCE"
                      ? "Manutenção"
                      : "Disponível"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        onClick={() => signOut({ callbackUrl: "/login" })}
        className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-2xl bg-white text-red-600 font-medium shadow-sm active:scale-95 transition-transform"
      >
        <LogOut className="w-5 h-5" />
        Sair do aplicativo
      </button>
    </div>
  );
}

function Linha({ termo, valor }: { termo: string; valor: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-gray-500">{termo}</dt>
      <dd className="text-gray-900 font-medium text-right">{valor}</dd>
    </div>
  );
}
