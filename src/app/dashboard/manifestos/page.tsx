"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Plus, Loader2, Route, Truck, Package, MapPin, User, ArrowRight, AlertTriangle, LogIn } from "lucide-react";
import { COLLECTION_STATUS, MANIFEST_STATUS, statusBadge } from "@/lib/format";
import { canEmbark, isManifestEditable, manifestLoadsLabel } from "@/lib/manifestos";
import { diaNoBrasil } from "@/lib/financeiro";
import { rotuloDaAusencia } from "@/lib/equipe";
import { haQuantoTempo } from "@/lib/posicao";
import { pode } from "@/lib/permissoes";
import type { FaltasParaSair } from "@/lib/mdfe";
import { loadManifestos, type Manifesto, type ManifestosState, type Minuta } from "./carregar";
import { TelaDaViagem } from "./viagem";

// A mensagem que o servidor devolveu; `fallback` quando a resposta não é JSON.
async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  return typeof body?.error === "string" ? body.error : fallback;
}

export default function ManifestosPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  // Viagem em montagem aberta no modal para alteração; nulo quando é viagem nova.
  const [editing, setEditing] = useState<Manifesto | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [state, setState] = useState<ManifestosState>({ status: "loading" });
  // Id do manifesto ou da carga com ação em andamento, para travar o botão.
  const [busyId, setBusyId] = useState<string | null>(null);
  // A viagem aberta na tela de dados, rota, despesas e acerto.
  const [viagem, setViagem] = useState<Manifesto | null>(null);
  // Ver o acerto é de quem lê o financeiro; aprovar despesa, de quem lança
  // nele. Só para mostrar a aba e os botões: a API confere de novo.
  const { data: session } = useSession();
  const veAcerto = pode(session?.user?.role, "financeiroVer");
  const aprovaDespesa = pode(session?.user?.role, "financeiro");
  const alteraViagem = pode(session?.user?.role, "manifestos");
  const veFiscal = pode(session?.user?.role, "fiscalVer");
  const emiteFiscal = pode(session?.user?.role, "fiscal");
  // A aba em que a tela da viagem abre: "MDF-e" quando a pessoa aceita encerrar o MDF-e ao finalizar.
  const [abaDaViagem, setAbaDaViagem] = useState<"Dados" | "MDF-e">("Dados");
  // A saída que o servidor não liberou por falta de CT-e ou de MDF-e (409): o cartão da viagem mostra o que falta.
  const [bloqueio, setBloqueio] = useState<{ manifestId: string; faltas: FaltasParaSair } | null>(null);

  const [formData, setFormData] = useState({
    driverId: "",
    vehicleId: "",
    collectionIds: [] as string[],
  });

  const show = useCallback((result: ManifestosState) => {
    if (result.status === "error" || result.status === "expired") console.error("Manifestos API error:", result.cause);
    setState(result);
  }, []);

  const fetchData = useCallback(async () => {
    setState({ status: "loading" });
    show(await loadManifestos((url) => fetch(url)));
  }, [show]);

  // O estado inicial já é "loading": o efeito só dispara a carga.
  useEffect(() => {
    let active = true;
    loadManifestos((url) => fetch(url)).then((result) => {
      if (active) show(result);
    });
    return () => {
      active = false;
    };
  }, [show]);

  // Quem está ausente hoje (férias, folga, atestado...), pelo id do motorista. É só
  // para avisar na montagem: se a leitura falhar, a viagem é montada sem o aviso.
  const [ausentesHoje, setAusentesHoje] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    fetch(`/api/equipe/ausencias?dia=${diaNoBrasil(new Date())}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((ausencias: { driverId: string | null; type: string }[]) => {
        if (!active) return;
        const porMotorista: Record<string, string> = {};
        for (const ausencia of ausencias) if (ausencia.driverId) porMotorista[ausencia.driverId] = rotuloDaAusencia(ausencia.type);
        setAusentesHoje(porMotorista);
      })
      .catch(() => {
        // Sem a lista de ausências não há aviso.
      });
    return () => {
      active = false;
    };
  }, []);

  const isLoading = state.status === "loading";
  const ready = state.status === "ready";
  const manifestos = ready ? state.manifestos : [];
  // Carga livre é só a que o servidor aceitaria: coletada e fora de manifesto.
  const minutas = ready ? state.coletas.filter(canEmbark) : [];
  const motoristas = ready ? state.motoristas.filter((m) => m.active) : [];
  const veiculos = ready ? state.veiculos : [];
  // A viagem aberta, como veio na última leitura; enquanto a lista recarrega, a que já estava na tela.
  const viagemAberta = viagem && (manifestos.find((m) => m.id === viagem.id) ?? viagem);

  // Recarrega sem trocar a lista pelo indicador de carga: a tela da viagem fica aberta por cima.
  const recarregar = useCallback(async () => {
    show(await loadManifestos((url) => fetch(url)));
  }, [show]);

  const toggleMinuta = (id: string) => {
    setFormData(prev => ({
      ...prev,
      collectionIds: prev.collectionIds.includes(id) 
        ? prev.collectionIds.filter(i => i !== id)
        : [...prev.collectionIds, id]
    }));
  };

  const openNew = () => {
    setEditing(null);
    setFormData({ driverId: "", vehicleId: "", collectionIds: [] });
    setIsModalOpen(true);
  };

  const openEdit = (manifesto: Manifesto) => {
    setEditing(manifesto);
    setFormData({ driverId: manifesto.driver.id, vehicleId: manifesto.vehicle.id, collectionIds: [] });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditing(null);
  };

  const handleSave = async () => {
    if (!formData.driverId || !formData.vehicleId || (!editing && formData.collectionIds.length === 0)) {
      alert("Por favor, selecione um motorista, um veículo e pelo menos uma minuta para a viagem.");
      return;
    }

    const fallback = editing ? "Erro ao alterar a viagem." : "Erro ao criar manifesto.";
    setIsSaving(true);
    try {
      const res = editing
        ? await fetch(`/api/manifestos/${editing.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              driverId: formData.driverId,
              vehicleId: formData.vehicleId,
              ...(formData.collectionIds.length > 0 ? { addCollectionIds: formData.collectionIds } : {}),
            }),
          })
        : await fetch('/api/manifestos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData),
          });

      if (res.ok) {
        closeModal();
        setFormData({ driverId: "", vehicleId: "", collectionIds: [] });
        fetchData();
      } else {
        alert(await errorMessage(res, fallback));
      }
    } catch {
      alert(fallback);
    } finally {
      setIsSaving(false);
    }
  };

  // Liberar a saída e cancelar: um POST sem corpo na rota da ação.
  const handleAction = async (manifesto: Manifesto, action: "liberar" | "cancelar", question: string, fallback: string) => {
    if (!confirm(question)) return;

    setBusyId(manifesto.id);
    setBloqueio(null);
    try {
      const res = await fetch(`/api/manifestos/${manifesto.id}/${action}`, { method: "POST" });
      const corpo = (await res.json().catch(() => null)) as { aviso?: string | null; error?: string; faltas?: FaltasParaSair } | null;
      if (res.ok) {
        // Em homologação ou sem emitente fiscal a falta de documento não bloqueia: o servidor só avisa.
        await fetchData();
        if (corpo?.aviso) alert(corpo.aviso);
      } else if (res.status === 409 && corpo?.faltas) {
        // Empresa que emite pelo TMS em produção: a saída espera o CT-e de cada carga e o MDF-e. O cartão mostra o que falta.
        setBloqueio({ manifestId: manifesto.id, faltas: corpo.faltas });
      } else {
        alert(typeof corpo?.error === "string" ? corpo.error : fallback);
      }
    } catch {
      alert(fallback);
    } finally {
      setBusyId(null);
    }
  };

  const handleRelease = (manifesto: Manifesto) =>
    handleAction(
      manifesto,
      "liberar",
      'Liberar a saída desta viagem? As cargas passam para "Em rota de entrega", o motorista passa a vê-la e ela não pode mais ser alterada.',
      "Erro ao liberar a viagem.",
    );

  const handleCancel = (manifesto: Manifesto) =>
    handleAction(
      manifesto,
      "cancelar",
      "Cancelar esta viagem? As cargas voltam a ficar livres para outra viagem.",
      "Erro ao cancelar a viagem.",
    );

  const handleRemove = async (manifesto: Manifesto, carga: Minuta) => {
    const nome = carga.client?.tradeName || carga.client?.companyName || "esta carga";
    if (!confirm(`Retirar a carga de ${nome} desta viagem? Ela volta para "Coletado" e fica livre para outra viagem.`)) return;

    setBusyId(carga.id);
    try {
      const res = await fetch(`/api/manifestos/${manifesto.id}/coletas/${carga.id}`, { method: "DELETE" });
      if (res.ok) {
        await fetchData();
      } else {
        alert(await errorMessage(res, "Erro ao retirar a carga."));
      }
    } catch {
      alert("Erro ao retirar a carga.");
    } finally {
      setBusyId(null);
    }
  };

  const handleFinish = async (manifesto: Manifesto) => {
    if (!confirm("Finalizar esta viagem? Ela sai da lista do motorista e não pode ser reaberta.")) return;

    setBusyId(manifesto.id);
    try {
      const res = await fetch(`/api/manifestos/${manifesto.id}/finalizar`, { method: "POST" });
      if (res.ok) {
        const corpo = (await res.json().catch(() => null)) as { mdfesAbertos?: { numero: number }[] } | null;
        await fetchData();
        // O encerramento do MDF-e é obrigatório ao fim da viagem: a tela oferece, a pessoa informa data e município.
        const abertos = corpo?.mdfesAbertos ?? [];
        if (abertos.length > 0 && veFiscal && confirm(`Esta viagem tem MDF-e autorizado e ainda não encerrado (nº ${abertos.map((mdfe) => mdfe.numero).join(", ")}). O encerramento é obrigatório ao fim da viagem. Abrir o MDF-e para encerrar agora?`)) {
          setAbaDaViagem("MDF-e");
          setViagem(manifesto);
        }
      } else {
        alert(await errorMessage(res, "Erro ao finalizar a viagem."));
      }
    } catch {
      alert("Erro ao finalizar a viagem.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3 md:space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold font-outfit text-gray-900 dark:text-white">Manifestos Operacionais</h1>
          <p className="text-gray-500 text-sm mt-1">Gerencie viagens e roteiros de entrega</p>
        </div>
        <button 
          onClick={openNew}
          disabled={!ready}
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-xl flex items-center space-x-2 shadow-lg shadow-blue-500/30 transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>Montar Viagem</span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-[400px]">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        ) : state.status === "expired" ? (
          <div role="alert" className="flex items-center justify-between gap-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
            <span className="flex items-center gap-2">
              <LogIn className="w-5 h-5 shrink-0" />
              Sessão expirada. Entre novamente para ver os manifestos.
            </span>
            <Link href="/login" className="font-medium underline underline-offset-2 hover:no-underline">
              Entrar novamente
            </Link>
          </div>
        ) : state.status === "error" ? (
          <div role="alert" className="flex items-center justify-between gap-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
            <span className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              Não foi possível carregar os manifestos.
            </span>
            <button onClick={fetchData} className="font-medium underline underline-offset-2 hover:no-underline">
              Tentar de novo
            </button>
          </div>
        ) : manifestos.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl flex flex-col items-center justify-center h-[400px] text-center shadow-sm">
            <Route className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <h3 className="text-gray-500 dark:text-gray-400 font-medium">Nenhum manifesto de viagem criado</h3>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {manifestos.map(manifesto => {
              const selo = statusBadge(MANIFEST_STATUS, manifesto.status);
              const emRota = manifesto.status === "ROUTE";
              const emMontagem = isManifestEditable(manifesto);
              const total = manifesto.collections?.length || 0;
              const pendentes = manifesto.collections?.filter(col => col.status === "ROUTE").length || 0;
              return (
              <div key={manifesto.id} className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-3 md:p-6 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
                
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center space-x-2">
                    <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-xs font-bold px-2 py-1 rounded-md">
                      MDF-e #{manifesto.id.substring(0,6).toUpperCase()}
                    </span>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={`px-2.5 py-1 text-xs font-medium rounded-full border ${selo.className}`}>
                      {selo.label}
                    </span>
                    {/* Só com a viagem em rota e se o motorista compartilhou: há quanto tempo a posição chegou. */}
                    {emRota && manifesto.lastPositionAt && (
                      <span data-localizacao={manifesto.id} className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
                        <MapPin className="w-3 h-3" /> localização {haQuantoTempo(manifesto.lastPositionAt)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center space-x-3 text-sm text-gray-600 dark:text-gray-300">
                    <User className="w-4 h-4 text-gray-400" />
                    <span className="font-medium text-gray-900 dark:text-white">{manifesto.driver?.user?.name}</span>
                  </div>
                  
                  <div className="flex items-center space-x-3 text-sm text-gray-600 dark:text-gray-300">
                    <Truck className="w-4 h-4 text-gray-400" />
                    <span>
                      {manifesto.vehicle?.plate} <span className="text-xs text-gray-500">({manifesto.vehicle?.model})</span>
                    </span>
                    {/* Dados, ordem das entregas, despesas e acerto da viagem. */}
                    <button
                      type="button"
                      data-abrir-viagem={manifesto.id}
                      onClick={() => setViagem(manifesto)}
                      className="!ml-auto shrink-0 border border-gray-200 dark:border-gray-700 text-blue-700 dark:text-blue-400 hover:bg-gray-50 dark:hover:bg-gray-800 text-xs font-medium px-3 py-1.5 rounded-xl"
                    >
                      Viagem
                    </button>
                  </div>
                </div>

                <div className="mt-6 border-t border-gray-100 dark:border-gray-800 pt-4">
                  <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-3 flex items-center">
                    <Package className="w-4 h-4 mr-1.5" /> 
                    {manifestLoadsLabel(manifesto.status, total)}
                  </h4>
                  
                  <div className="space-y-3 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
                    {manifesto.collections?.map(col => {
                      const seloCarga = statusBadge(COLLECTION_STATUS, col.status);
                      return (
                      <div key={col.id} className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 text-sm">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-medium text-gray-900 dark:text-white truncate">{col.client?.tradeName || col.client?.companyName}</p>
                          <span className={`shrink-0 px-2 py-0.5 text-[11px] font-medium rounded-full border ${seloCarga.className}`}>
                            {seloCarga.label}
                          </span>
                        </div>
                        <div className="flex items-center justify-between mt-1">
                          <div className="flex items-center text-xs text-gray-500 space-x-1">
                            <span>{col.origin.split('-')[0]}</span>
                            <ArrowRight className="w-3 h-3" />
                            <span>{col.destination.split('-')[0]}</span>
                          </div>
                          {((emRota && col.status === "ROUTE") || (emMontagem && col.status === "COLLECTED")) && (
                            <button
                              onClick={() => handleRemove(manifesto, col)}
                              disabled={busyId !== null}
                              className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {busyId === col.id ? "Retirando..." : "Retirar"}
                            </button>
                          )}
                        </div>
                      </div>
                      );
                    })}
                  </div>
                </div>

                {emMontagem && bloqueio?.manifestId === manifesto.id && (
                  <div role="alert" data-saida-bloqueada={manifesto.id} className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900 space-y-1.5">
                    <p className="font-semibold">Saída não liberada: falta documento fiscal autorizado.</p>
                    {bloqueio.faltas.ctes.length > 0 && (
                      <p data-falta="cte" className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="min-w-0">
                          CT-e de {bloqueio.faltas.ctes.length === 1 ? "1 carga" : `${bloqueio.faltas.ctes.length} cargas`}: {bloqueio.faltas.ctes.map((carga) => carga.codigo).join(", ")}
                        </span>
                        {veFiscal && (
                          <Link href="/dashboard/fiscal/cte" data-atalho="cte" className="font-semibold text-blue-700 underline">
                            Emitir CT-e
                          </Link>
                        )}
                      </p>
                    )}
                    {bloqueio.faltas.mdfe && (
                      <p data-falta="mdfe" className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span>MDF-e da viagem{bloqueio.faltas.ctes.length > 0 ? " (depois dos CT-e)" : ""}</span>
                        {veFiscal && (
                          <button
                            type="button"
                            data-atalho="mdfe"
                            onClick={() => {
                              setAbaDaViagem("MDF-e");
                              setViagem(manifesto);
                            }}
                            className="font-semibold text-blue-700 underline"
                          >
                            Emitir MDF-e
                          </button>
                        )}
                      </p>
                    )}
                  </div>
                )}

                {emMontagem && (
                  <div className="mt-4 border-t border-gray-100 dark:border-gray-800 pt-4 flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => handleRelease(manifesto)}
                      disabled={total === 0 || busyId !== null}
                      title={total === 0 ? "Acrescente carga antes de liberar" : undefined}
                      className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-xl transition-all flex items-center space-x-2"
                    >
                      {busyId === manifesto.id && <Loader2 className="w-4 h-4 animate-spin" />}
                      <span>Liberar saída</span>
                    </button>
                    <button
                      onClick={() => openEdit(manifesto)}
                      disabled={busyId !== null}
                      className="border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium px-4 py-2 rounded-xl"
                    >
                      Alterar
                    </button>
                    <button
                      onClick={() => handleCancel(manifesto)}
                      disabled={busyId !== null}
                      className="ml-auto text-sm font-medium text-red-600 hover:text-red-700 disabled:opacity-50 disabled:cursor-not-allowed px-2 py-2"
                    >
                      Cancelar
                    </button>
                  </div>
                )}

                {emRota && (
                  <div className="mt-4 border-t border-gray-100 dark:border-gray-800 pt-4 flex items-center justify-between gap-3">
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {pendentes === 0
                        ? "Nenhuma carga em rota"
                        : pendentes === 1
                          ? "1 carga ainda em rota"
                          : `${pendentes} cargas ainda em rota`}
                    </span>
                    <button
                      onClick={() => handleFinish(manifesto)}
                      disabled={pendentes > 0 || busyId !== null}
                      className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-xl transition-all flex items-center space-x-2"
                    >
                      {busyId === manifesto.id && <Loader2 className="w-4 h-4 animate-spin" />}
                      <span>Finalizar viagem</span>
                    </button>
                  </div>
                )}
              </div>
              );
            })}
          </div>
        )}
      </div>

      {viagemAberta && (
        <TelaDaViagem
          key={`${viagemAberta.id}:${abaDaViagem}`}
          manifesto={viagemAberta}
          veAcerto={veAcerto}
          aprovaDespesa={aprovaDespesa}
          alteraViagem={alteraViagem}
          veFiscal={veFiscal}
          emiteFiscal={emiteFiscal}
          abaInicial={abaDaViagem}
          onClose={() => {
            setViagem(null);
            setAbaDaViagem("Dados");
          }}
          onChange={recarregar}
        />
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-stretch md:items-center justify-center md:p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-gray-900 md:rounded-2xl w-full max-w-5xl md:max-h-[90vh] overflow-hidden flex flex-col shadow-2xl border border-gray-100 dark:border-gray-800">
            <div className="p-3 md:p-6 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-white dark:bg-gray-900 z-10">
              <h2 className="text-base md:text-xl font-bold font-outfit text-gray-900 dark:text-white">
                {editing ? `Alterar Viagem #${editing.id.substring(0,6).toUpperCase()}` : "Montar Manifesto de Viagem"}
              </h2>
              <button onClick={closeModal} aria-label="Fechar" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                ✕
              </button>
            </div>
            
            <div className="p-3 md:p-6 flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-3 gap-3 md:gap-6">
              
              {/* Esquerda: Seleção de Veículo e Motorista */}
              <div className="space-y-2 md:space-y-6 lg:border-r lg:border-gray-100 dark:lg:border-gray-800 lg:pr-6">
                <div>
                  <h3 className="text-sm md:text-base font-medium text-gray-900 dark:text-white mb-1 md:mb-3">1. Equipe e Transporte</h3>
                  
                  <div className="grid grid-cols-2 gap-3 md:block md:space-y-4">
                    <div className="space-y-0.5 md:space-y-1.5 min-w-0">
                      <label className="text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300">Motorista</label>
                      <select 
                        value={formData.driverId}
                        onChange={(e) => setFormData({...formData, driverId: e.target.value})}
                        className="block w-full min-w-0 px-3 py-1.5 md:px-4 md:py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                      >
                        <option value="">Selecione um motorista...</option>
                        {motoristas.map(m => (
                          <option key={m.id} value={m.id}>{m.user?.name} - CPF: {m.cpf}{ausentesHoje[m.id] ? " (ausente hoje)" : ""}</option>
                        ))}
                      </select>
                      {/* Aviso, não trava: quem monta a viagem sabe se a ausência ainda vale. */}
                      {ausentesHoje[formData.driverId] && (
                        <p role="alert" data-aviso="ausencia" className="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-400">
                          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                          <span>Este motorista está ausente hoje ({ausentesHoje[formData.driverId].toLowerCase()}). Confira antes de liberar.</span>
                        </p>
                      )}
                    </div>

                    <div className="space-y-0.5 md:space-y-1.5 min-w-0">
                      <label className="text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300">Veículo</label>
                      <select 
                        value={formData.vehicleId}
                        onChange={(e) => setFormData({...formData, vehicleId: e.target.value})}
                        className="block w-full min-w-0 px-3 py-1.5 md:px-4 md:py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 outline-none dark:text-white uppercase"
                      >
                        <option value="">Selecione um veículo...</option>
                        {veiculos.map(v => (
                          <option key={v.id} value={v.id} disabled={v.status === "MAINTENANCE"}>
                            {v.plate} ({v.type}){v.status === "MAINTENANCE" ? " - em manutenção" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="bg-blue-50 dark:bg-blue-900/20 px-3 py-2 md:p-4 rounded-xl border border-blue-100 dark:border-blue-800/30">
                  <h4 className="hidden md:block text-sm font-semibold text-blue-800 dark:text-blue-400 mb-2">Resumo da Rota</h4>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 md:block md:space-y-2 text-sm text-blue-700 dark:text-blue-300">
                    {editing && <p>Já na viagem: <span className="font-bold">{editing.collections.length}</span></p>}
                    <p>{editing ? "A acrescentar" : "Entregas"}: <span className="font-bold">{formData.collectionIds.length}</span></p>
                    <p>{editing ? "Peso a acrescentar" : "Peso Total"}: <span className="font-bold">
                      {minutas.filter(m => formData.collectionIds.includes(m.id)).reduce((acc, curr) => acc + curr.weight, 0)} kg
                    </span></p>
                  </div>
                </div>

                <p className="hidden md:block text-xs text-gray-500 dark:text-gray-400">
                  A viagem nasce em montagem, com as cargas reservadas. Elas só passam para &quot;Em rota de entrega&quot; quando você liberar a saída.
                </p>
              </div>

              {/* Direita: Seleção de Minutas */}
              <div className="lg:col-span-2 flex flex-col h-full">
                <h3 className="text-sm md:text-base font-medium text-gray-900 dark:text-white mb-1 md:mb-3">2. {editing ? "Acrescente Minutas" : "Selecione as Minutas"} (Cargas Coletadas)</h3>
                
                {minutas.length === 0 ? (
                  <div className="flex-1 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl flex flex-col items-center justify-center text-center p-3 md:p-6">
                    <Package className="w-10 h-10 text-gray-300 mb-2" />
                    <p className="text-gray-500 font-medium">Não há carga livre para embarque. Só carga coletada entra na viagem: registre a coleta antes de montar.</p>
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto space-y-3 pr-2">
                    {minutas.map(minuta => {
                      const isSelected = formData.collectionIds.includes(minuta.id);
                      return (
                        <div 
                          key={minuta.id}
                          onClick={() => toggleMinuta(minuta.id)}
                          className={`cursor-pointer border p-4 rounded-xl transition-all ${
                            isSelected 
                              ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-900/20 dark:border-blue-500' 
                              : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex items-center space-x-3">
                              <div className={`w-5 h-5 rounded border flex items-center justify-center mt-0.5 ${
                                isSelected ? 'bg-blue-500 border-blue-500' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700'
                              }`}>
                                {isSelected && <span className="text-white text-xs">✓</span>}
                              </div>
                              <div>
                                <p className="font-medium text-gray-900 dark:text-white text-sm">
                                  {minuta.client?.tradeName || minuta.client?.companyName}
                                </p>
                                <div className="flex items-center space-x-2 mt-1">
                                  <span className="text-xs text-gray-500 flex items-center"><MapPin className="w-3 h-3 mr-1" /> {minuta.origin.split('-')[0]}</span>
                                  <ArrowRight className="w-3 h-3 text-gray-400" />
                                  <span className="text-xs text-gray-500">{minuta.destination.split('-')[0]}</span>
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300">{minuta.weight} kg</p>
                              <p className="text-xs text-gray-500">{minuta.volumes} vol</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            
            <div className="p-3 md:p-6 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 flex justify-end space-x-3">
              <button
                onClick={closeModal}
                className="px-4 py-2 md:px-6 md:py-2.5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-medium"
              >
                Cancelar
              </button>
              <button 
                onClick={handleSave}
                disabled={isSaving || (!editing && formData.collectionIds.length === 0)}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white px-4 py-2 md:px-6 md:py-2.5 rounded-xl font-medium shadow-lg shadow-blue-500/30 transition-all flex items-center space-x-2"
              >
                {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{editing ? "Salvar alterações" : `Montar viagem (${formData.collectionIds.length})`}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
