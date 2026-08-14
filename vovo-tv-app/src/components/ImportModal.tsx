import React, { useState } from 'react';
import { X, Upload, Link, AlertCircle, CheckCircle } from 'lucide-react';
import { parseM3UContent } from '../utils/m3uParser';
import type { Channel } from '../types';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportChannels: (newChannels: Channel[]) => void;
}

export const ImportModal: React.FC<ImportModalProps> = ({
  isOpen,
  onClose,
  onImportChannels
}) => {
  const [url, setUrl] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState<number | null>(null);

  if (!isOpen) return null;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setError(null);
    setSuccessCount(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const channels = parseM3UContent(content);
        if (channels.length === 0) {
          setError('Nenhum canal válido foi encontrado neste arquivo .m3u.');
          setIsLoading(false);
          return;
        }
        setSuccessCount(channels.length);
        setTimeout(() => {
          onImportChannels(channels);
          onClose();
        }, 1200);
      } catch {
        setError('Erro ao processar o arquivo M3U.');
      } finally {
        setIsLoading(false);
      }
    };
    reader.onerror = () => {
      setError('Erro ao ler o arquivo selecionado.');
      setIsLoading(false);
    };
    reader.readAsText(file);
  };

  const handleUrlImport = async () => {
    if (!url.trim()) return;

    setIsLoading(true);
    setError(null);
    setSuccessCount(null);

    try {
      const response = await fetch(url.trim());
      if (!response.ok) throw new Error('Não foi possível carregar a lista do link informado.');
      const content = await response.text();
      const channels = parseM3UContent(content);

      if (channels.length === 0) {
        setError('Nenhum canal válido foi encontrado no link M3U.');
        setIsLoading(false);
        return;
      }

      setSuccessCount(channels.length);
      setTimeout(() => {
        onImportChannels(channels);
        onClose();
      }, 1200);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar lista via URL. Verifique o link e a conexão.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 w-full max-w-lg rounded-3xl p-6 shadow-2xl flex flex-col gap-6 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-amber-400/20 text-amber-400 rounded-2xl">
              <Upload className="w-7 h-7" />
            </div>
            <div>
              <h2 className="text-white text-2xl font-black">Importar Lista M3U</h2>
              <p className="text-slate-400 text-sm font-semibold">Adicione mais canais ao aplicativo</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Feedback messages */}
        {error && (
          <div className="flex items-center gap-3 bg-rose-500/20 border border-rose-500/40 text-rose-300 p-4 rounded-2xl text-sm font-bold">
            <AlertCircle className="w-6 h-6 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {successCount !== null && (
          <div className="flex items-center gap-3 bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 p-4 rounded-2xl text-base font-black">
            <CheckCircle className="w-6 h-6 shrink-0" />
            <span>{successCount} canais importados com sucesso!</span>
          </div>
        )}

        {/* Option 1: File Picker */}
        <div className="flex flex-col gap-2">
          <label className="text-white font-bold text-base flex items-center gap-2">
            <Upload className="w-5 h-5 text-amber-400" />
            Escolher Arquivo do Celular (.m3u ou .m3u8)
          </label>
          <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-700 hover:border-amber-400/80 bg-slate-800/50 hover:bg-slate-800/80 rounded-2xl p-6 cursor-pointer transition">
            <Upload className="w-10 h-10 text-slate-400 mb-2" />
            <span className="text-white font-bold text-base">Toque aqui para selecionar o arquivo</span>
            <span className="text-slate-400 text-xs mt-1">Formatos suportados: .m3u, .m3u8, .txt</span>
            <input
              type="file"
              accept=".m3u,.m3u8,.txt"
              onChange={handleFileUpload}
              className="hidden"
              disabled={isLoading}
            />
          </label>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3 text-slate-500 text-xs font-black uppercase">
          <div className="flex-1 h-px bg-slate-800"></div>
          <span>OU POR LINK URL</span>
          <div className="flex-1 h-px bg-slate-800"></div>
        </div>

        {/* Option 2: URL Input */}
        <div className="flex flex-col gap-2">
          <label className="text-white font-bold text-base flex items-center gap-2">
            <Link className="w-5 h-5 text-sky-400" />
            Colar Link da Lista M3U
          </label>
          <div className="flex gap-2">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://exemplo.com/lista.m3u"
              className="flex-1 bg-slate-800 text-white placeholder-slate-500 text-base font-medium px-4 py-3 rounded-2xl border border-slate-700 focus:outline-none focus:border-amber-400"
              disabled={isLoading}
            />
            <button
              onClick={handleUrlImport}
              disabled={isLoading || !url.trim()}
              className="bg-amber-400 hover:bg-amber-500 active:scale-95 disabled:opacity-50 text-slate-950 font-black px-6 py-3 rounded-2xl transition text-base shrink-0 shadow-md"
            >
              {isLoading ? 'Carregando...' : 'Carregar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
