// stream.js — SSE streaming, tag parsing, event dispatch

import { state, mergeServerCharacter } from './state.js';
import { startStreamLine, appendStreamToken, appendActionText, finishStreamLine, addPlayerLine } from './narrative.js';
import { updateHUD } from './hud.js';
import { setLocation, showPortrait } from './scene.js';
import { openShop, closeShop } from './shop.js';
import { setInputState, renderChoices, clearChoices, addChoice } from './input.js';
import { speakElevenLabs } from './audio.js';

export async function streamMessage(endpoint, body) {
  if (state.isStreaming) return;
  state.isStreaming = true;
  setInputState('action', false);
  clearChoices();
  document.getElementById('choices-area').classList.remove('visible');
  document.getElementById('thinking').style.display = 'flex';

  let ttsText = '';
  let doneVoiceId = null;
  let doneInputHint = 'action';

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    document.getElementById('thinking').style.display = 'none';
    startStreamLine();

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const evt = JSON.parse(line.slice(6));
          if (evt.type === 'token') { appendStreamToken(evt.text); ttsText += evt.text; }
          if (evt.type === 'action_text') { appendActionText(evt.text); ttsText += evt.text; }
          if (evt.type === 'location') setLocation(evt.text);
          if (evt.type === 'voice') state.currentVoiceId = evt.voice;
          if (evt.type === 'choice') addChoice(evt.text);
          if (evt.type === 'input_hint') doneInputHint = evt.hint;
          if (evt.type === 'shop') { if (evt.shop === 'close') closeShop(); else openShop(evt.shop); }
          if (evt.type === 'portrait') showPortrait(evt.name, evt.desc, evt.kind);
          if (evt.type === 'stat_change') {
            // Real-time stat update from server
            if (evt.stat === 'gold' && evt.value != null) {
              state.character.gold = evt.value;
            } else if (evt.stat === 'hd' && evt.value != null) {
              state.character.hd = evt.value;
            }
            updateHUD(true);
            // Update shop gold display if open
            const shopGold = document.getElementById('shop-gold');
            if (shopGold) shopGold.textContent = `Your gold: ${state.character.gold || 0}`;
          }
          if (evt.type === 'done') {
            finishStreamLine();
            doneVoiceId = evt.voiceId;
            // Sync character from server state on every response
            if (evt.characterState) {
              mergeServerCharacter(evt.characterState);
              updateHUD(true);
            } else if (evt.phaseUpdate?.character) {
              mergeServerCharacter(evt.phaseUpdate.character);
              updateHUD(true);
            }
          }
        } catch (_) {}
      }
    }
  } catch (err) {
    document.getElementById('thinking').style.display = 'none';
    addPlayerLine('[Connection error \u2014 try refreshing]');
  } finally {
    state.isStreaming = false;
    renderChoices();
    setInputState(doneInputHint, true);
    if (ttsText.trim() && doneVoiceId) speakElevenLabs(ttsText.trim(), doneVoiceId);
  }
}
