import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface SheetProps {
  isOpen: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Rodape fixo, para o botao principal nunca sumir junto com a rolagem. */
  footer?: React.ReactNode;
}

/**
 * Painel de tela cheia.
 *
 * Tela cheia em vez de caixa flutuante de proposito: janelinha no meio da tela
 * deixa o fundo visivel e a vovo tenta tocar no que esta atras. Ocupando tudo,
 * so existe uma coisa por vez e um unico jeito de sair.
 */
export const Sheet: React.FC<SheetProps> = ({
  isOpen,
  title,
  subtitle,
  onClose,
  children,
  footer
}) => {
  // Trava a rolagem do fundo enquanto o painel esta aberto
  useEffect(() => {
    if (!isOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, [isOpen]);

  // Escape fecha, para quem estiver testando no navegador ou com teclado
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col bg-noite-900"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <header className="area-segura-topo area-segura-lados shrink-0 border-b border-noite-600 bg-noite-800 px-4 pb-3">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-2xl font-black text-tinta-100">{title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-base text-tinta-300">{subtitle}</p>}
          </div>

          <button
            onClick={onClose}
            className="flex h-toque min-w-toque items-center justify-center gap-2 rounded-2xl border-2 border-noite-500 bg-noite-700 px-4 text-tinta-100 transition active:scale-95 active:bg-noite-600"
            aria-label={`Fechar ${title}`}
          >
            <X className="h-7 w-7" strokeWidth={2.5} />
            <span className="text-lg font-black">Fechar</span>
          </button>
        </div>
      </header>

      <div className="area-segura-lados flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        <div className="mx-auto w-full max-w-3xl">{children}</div>
      </div>

      {footer && (
        <footer className="area-segura-base area-segura-lados shrink-0 border-t border-noite-600 bg-noite-800 px-4 pt-3">
          <div className="mx-auto w-full max-w-3xl">{footer}</div>
        </footer>
      )}
    </div>
  );
};
