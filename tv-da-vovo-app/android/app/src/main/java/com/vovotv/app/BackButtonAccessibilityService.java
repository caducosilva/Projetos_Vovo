package com.vovotv.app;

import android.accessibilityservice.AccessibilityService;
import android.view.KeyEvent;
import android.view.accessibility.AccessibilityEvent;

/**
 * Servico de sistema, fica rodando em segundo plano na TV inteira (nao so
 * dentro do Vovo TV): conta quantas vezes o Voltar do controle foi apertado
 * seguido e, na segunda vez dentro de 1.5s, manda a TV pra tela inicial do
 * launcher. Sem isto, cada app decide sozinho quando o Voltar sai ou nao, e
 * a vovo ficava presa dentro de apps que nao soltam com um Voltar so.
 */
public class BackButtonAccessibilityService extends AccessibilityService {

    private static final long JANELA_MS = 1500;
    private long ultimoVoltarEm = 0;

    @Override
    protected boolean onKeyEvent(KeyEvent event) {
        if (event.getKeyCode() != KeyEvent.KEYCODE_BACK || event.getAction() != KeyEvent.ACTION_DOWN) {
            return super.onKeyEvent(event);
        }

        long agora = System.currentTimeMillis();
        if (agora - ultimoVoltarEm < JANELA_MS) {
            ultimoVoltarEm = 0;
            performGlobalAction(GLOBAL_ACTION_HOME);
            return true; // engole este toque: o app atual nao precisa tratar a segunda tecla
        }

        ultimoVoltarEm = agora;
        return super.onKeyEvent(event); // primeiro toque segue normal pro app tratar
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // nao usamos eventos de acessibilidade, so a tecla Voltar
    }

    @Override
    public void onInterrupt() {
        // nada para limpar
    }
}
