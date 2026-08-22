import type { Language } from './api';

export const languageLabels: Record<Language, string> = {
  English: 'English', German: 'Deutsch', Italian: 'Italiano', French: 'Français',
  Spanish: 'Español', Japanese: '日本語', Portuguese: 'Português',
};

const order: Language[] = ['English', 'German', 'Italian', 'French', 'Spanish', 'Japanese', 'Portuguese'];
const m = {
  feed: ['Feed', 'Feed', 'Feed', 'Flux', 'Feed', 'フィード', 'Feed'],
  videos: ['videos', 'Videos', 'video', 'vidéos', 'vídeos', '動画', 'vídeos'],
  settings: ['Settings', 'Einstellungen', 'Impostazioni', 'Paramètres', 'Ajustes', '設定', 'Definições'],
  add: ['Add', 'Hinzufügen', 'Aggiungi', 'Ajouter', 'Añadir', '追加', 'Adicionar'],
  refresh: ['Refresh feeds', 'Feeds aktualisieren', 'Aggiorna feed', 'Actualiser les flux', 'Actualizar feeds', 'フィードを更新', 'Atualizar feeds'],
  lightTheme: ['Light theme', 'Helles Design', 'Tema chiaro', 'Thème clair', 'Tema claro', 'ライトテーマ', 'Tema claro'],
  darkTheme: ['Dark theme', 'Dunkles Design', 'Tema scuro', 'Thème sombre', 'Tema oscuro', 'ダークテーマ', 'Tema escuro'],
  spent: ['Total spent', 'Gesamtausgaben', 'Spesa totale', 'Dépenses totales', 'Gasto total', '合計費用', 'Gasto total'],
  suggestion: ['Use {language} for the dashboard and future analyses?', '{language} für Dashboard und künftige Analysen verwenden?', 'Usare {language} per la dashboard e le analisi future?', 'Utiliser {language} pour le tableau de bord et les prochaines analyses ?', '¿Usar {language} para el panel y los próximos análisis?', 'ダッシュボードと今後の分析に{language}を使用しますか？', 'Usar {language} no painel e nas futuras análises?'],
  useLanguage: ['Use language', 'Sprache verwenden', 'Usa lingua', 'Utiliser', 'Usar idioma', '言語を使用', 'Usar idioma'],
  dismiss: ['Not now', 'Nicht jetzt', 'Non ora', 'Pas maintenant', 'Ahora no', '後で', 'Agora não'],
  all: ['All', 'Alle', 'Tutti', 'Tous', 'Todos', 'すべて', 'Todos'],
  unread: ['Unread', 'Ungelesen', 'Non letti', 'Non lus', 'No leídos', '未読', 'Não lidos'],
  read: ['Read', 'Gelesen', 'Letti', 'Lus', 'Leídos', '既読', 'Lidos'],
  failed: ['Failed', 'Fehlgeschlagen', 'Falliti', 'Échecs', 'Fallidos', '失敗', 'Falhados'],
  allChannels: ['All channels', 'Alle Kanäle', 'Tutti i canali', 'Toutes les chaînes', 'Todos los canales', 'すべてのチャンネル', 'Todos os canais'],
  published: ['Published', 'Veröffentlicht', 'Pubblicazione', 'Publication', 'Publicación', '公開日', 'Publicado'],
  analyzed: ['Analyzed', 'Analysiert', 'Analisi', 'Analyse', 'Análisis', '分析日', 'Analisado'],
  newest: ['Newest first', 'Neueste zuerst', 'Più recenti', 'Plus récents', 'Más recientes', '新しい順', 'Mais recentes'],
  oldest: ['Oldest first', 'Älteste zuerst', 'Meno recenti', 'Plus anciens', 'Más antiguos', '古い順', 'Mais antigos'],
  purge: ['Purge old read', 'Alte gelesene löschen', 'Elimina vecchi letti', 'Purger les anciens lus', 'Purgar leídos antiguos', '古い既読を削除', 'Remover lidos antigos'],
  previous: ['Previous', 'Zurück', 'Precedente', 'Précédent', 'Anterior', '前へ', 'Anterior'],
  next: ['Next', 'Weiter', 'Successivo', 'Suivant', 'Siguiente', '次へ', 'Seguinte'],
  perPage: ['per page', 'pro Seite', 'per pagina', 'par page', 'por página', '件/ページ', 'por página'],
  empty: ['Nothing here yet.', 'Noch keine Einträge.', 'Non c’è ancora nulla.', 'Rien pour le moment.', 'Todavía no hay nada.', 'まだありません。', 'Ainda não há nada.'],
  queued: ['Queued', 'Warteschlange', 'In coda', 'En attente', 'En cola', '待機中', 'Na fila'],
  downloading: ['Downloading', 'Download', 'Download', 'Téléchargement', 'Descargando', 'ダウンロード中', 'A transferir'],
  transcribing: ['Transcribing', 'Transkription', 'Trascrizione', 'Transcription', 'Transcribiendo', '文字起こし中', 'A transcrever'],
  summarizing: ['Summarizing', 'Zusammenfassung', 'Sintesi', 'Résumé', 'Resumiendo', '要約中', 'A resumir'],
  ready: ['Ready', 'Bereit', 'Pronto', 'Prêt', 'Listo', '完了', 'Pronto'],
  attempt: ['Attempt {current} of {max}', 'Versuch {current} von {max}', 'Tentativo {current} di {max}', 'Tentative {current} sur {max}', 'Intento {current} de {max}', '{max}回中{current}回目', 'Tentativa {current} de {max}'],
  retryAt: ['Retry {time}', 'Neuer Versuch {time}', 'Nuovo tentativo {time}', 'Nouvel essai {time}', 'Reintento {time}', '{time}に再試行', 'Nova tentativa {time}'],
  retry: ['Retry', 'Erneut versuchen', 'Riprova', 'Réessayer', 'Reintentar', '再試行', 'Tentar novamente'],
  delete: ['Delete', 'Löschen', 'Elimina', 'Supprimer', 'Eliminar', '削除', 'Eliminar'],
  confirm: ['Confirm', 'Bestätigen', 'Conferma', 'Confirmer', 'Confirmar', '確認', 'Confirmar'],
  deleteConfirm: ['Delete this video?', 'Dieses Video löschen?', 'Eliminare questo video?', 'Supprimer cette vidéo ?', '¿Eliminar este vídeo?', 'この動画を削除しますか？', 'Eliminar este vídeo?'],
  deleteChannelConfirm: ['Delete this channel and all its videos?', 'Diesen Kanal und alle seine Videos löschen?', 'Eliminare questo canale e tutti i suoi video?', 'Supprimer cette chaîne et toutes ses vidéos ?', '¿Eliminar este canal y todos sus vídeos?', 'このチャンネルとすべての動画を削除しますか？', 'Eliminar este canal e todos os seus vídeos?'],
  importConfirm: ['Replace the current database with this backup?', 'Die aktuelle Datenbank durch dieses Backup ersetzen?', 'Sostituire il database corrente con questo backup?', 'Remplacer la base actuelle par cette sauvegarde ?', '¿Sustituir la base actual por esta copia?', '現在のデータベースをこのバックアップで置き換えますか？', 'Substituir a base atual por esta cópia?'],
  redownloadConfirm: ['This video may be discovered again on the next poll. Delete it anyway?', 'Dieses Video kann beim nächsten Abruf erneut gefunden werden. Trotzdem löschen?', 'Il video potrebbe essere riscoperto al prossimo aggiornamento. Eliminarlo comunque?', 'Cette vidéo peut être redécouverte au prochain relevé. La supprimer ?', 'El vídeo puede volver a detectarse. ¿Eliminarlo?', '次回の更新で再検出される可能性があります。削除しますか？', 'O vídeo pode ser descoberto novamente. Eliminar?'],
  purgeConfirm: ['Delete old read videos?', 'Alte gelesene Videos löschen?', 'Eliminare i vecchi video letti?', 'Supprimer les anciennes vidéos lues ?', '¿Eliminar vídeos leídos antiguos?', '古い既読動画を削除しますか？', 'Eliminar vídeos lidos antigos?'],
  summary: ['Executive summary', 'Zusammenfassung', 'Sintesi', 'Résumé', 'Resumen', '概要', 'Resumo'],
  keyPoints: ['Key points', 'Kernpunkte', 'Punti chiave', 'Points clés', 'Puntos clave', '要点', 'Pontos-chave'],
  chapters: ['Chapters', 'Kapitel', 'Capitoli', 'Chapitres', 'Capítulos', 'チャプター', 'Capítulos'],
  watch: ['Watch on YouTube', 'Auf YouTube ansehen', 'Guarda su YouTube', 'Voir sur YouTube', 'Ver en YouTube', 'YouTubeで見る', 'Ver no YouTube'],
  markRead: ['Mark read', 'Als gelesen markieren', 'Segna come letto', 'Marquer comme lu', 'Marcar como leído', '既読にする', 'Marcar como lido'],
  markUnread: ['Mark unread', 'Als ungelesen markieren', 'Segna come non letto', 'Marquer comme non lu', 'Marcar como no leído', '未読にする', 'Marcar como não lido'],
  tokens: ['Tokens', 'Tokens', 'Token', 'Jetons', 'Tokens', 'トークン', 'Tokens'],
  estimatedCost: ['Estimated cost', 'Geschätzte Kosten', 'Costo stimato', 'Coût estimé', 'Coste estimado', '推定費用', 'Custo estimado'],
  back: ['Back to feed', 'Zurück zum Feed', 'Torna al feed', 'Retour au flux', 'Volver al feed', 'フィードに戻る', 'Voltar ao feed'],
  processing: ['Analysis in progress', 'Analyse läuft', 'Analisi in corso', 'Analyse en cours', 'Análisis en curso', '分析中', 'Análise em curso'],
  error: ['Error', 'Fehler', 'Errore', 'Erreur', 'Error', 'エラー', 'Erro'],
  channels: ['Channels', 'Kanäle', 'Canali', 'Chaînes', 'Canales', 'チャンネル', 'Canais'],
  inference: ['Inference engine', 'Inferenz-Engine', 'Motore di inferenza', 'Moteur d’inférence', 'Motor de inferencia', '推論エンジン', 'Motor de inferência'],
  provider: ['Provider', 'Anbieter', 'Provider', 'Fournisseur', 'Proveedor', 'プロバイダー', 'Fornecedor'],
  model: ['Model', 'Modell', 'Modello', 'Modèle', 'Modelo', 'モデル', 'Modelo'],
  apiKey: ['API key', 'API-Schlüssel', 'Chiave API', 'Clé API', 'Clave API', 'APIキー', 'Chave API'],
  endpoint: ['Endpoint', 'Endpunkt', 'Endpoint', 'Point d’accès', 'Endpoint', 'エンドポイント', 'Endpoint'],
  apiVersion: ['API version', 'API-Version', 'Versione API', 'Version API', 'Versión API', 'APIバージョン', 'Versão API'],
  language: ['Language', 'Sprache', 'Lingua', 'Langue', 'Idioma', '言語', 'Idioma'],
  output: ['Output', 'Ausgabe', 'Output', 'Sortie', 'Salida', '出力', 'Saída'],
  tone: ['Tone', 'Stil', 'Tono', 'Ton', 'Tono', 'トーン', 'Tom'],
  analytical: ['Analytical', 'Analytisch', 'Analitico', 'Analytique', 'Analítico', '分析的', 'Analítico'],
  creative: ['Creative', 'Kreativ', 'Creativo', 'Créatif', 'Creativo', 'クリエイティブ', 'Criativo'],
  minimalist: ['Minimalist', 'Minimalistisch', 'Minimalista', 'Minimaliste', 'Minimalista', 'ミニマル', 'Minimalista'],
  scheduling: ['Scheduling', 'Zeitplanung', 'Pianificazione', 'Planification', 'Planificación', 'スケジュール', 'Agendamento'],
  pollInterval: ['Poll interval (minutes)', 'Abrufintervall (Minuten)', 'Intervallo aggiornamento (minuti)', 'Intervalle (minutes)', 'Intervalo (minutos)', '更新間隔（分）', 'Intervalo (minutos)'],
  maxAge: ['Maximum video age (days)', 'Maximales Videoalter (Tage)', 'Età massima video (giorni)', 'Âge maximal (jours)', 'Edad máxima (días)', '動画の最大日数', 'Idade máxima (dias)'],
  whisper: ['Whisper fallback', 'Whisper-Fallback', 'Fallback Whisper', 'Repli Whisper', 'Respaldo Whisper', 'Whisperフォールバック', 'Fallback Whisper'],
  enabled: ['Enabled', 'Aktiviert', 'Attivo', 'Activé', 'Activado', '有効', 'Ativo'],
  pricing: ['Model pricing', 'Modellpreise', 'Prezzi modelli', 'Tarifs des modèles', 'Precios de modelos', 'モデル料金', 'Preços dos modelos'],
  database: ['Database', 'Datenbank', 'Database', 'Base de données', 'Base de datos', 'データベース', 'Base de dados'],
  exportDb: ['Export database', 'Datenbank exportieren', 'Esporta database', 'Exporter la base', 'Exportar base', 'データベースを出力', 'Exportar base'],
  importDb: ['Import database', 'Datenbank importieren', 'Importa database', 'Importer la base', 'Importar base', 'データベースを取込', 'Importar base'],
  save: ['Save settings', 'Einstellungen speichern', 'Salva impostazioni', 'Enregistrer', 'Guardar ajustes', '設定を保存', 'Guardar definições'],
  discard: ['Discard', 'Verwerfen', 'Annulla modifiche', 'Annuler', 'Descartar', '破棄', 'Descartar'],
  inputPrice: ['Input / 1M', 'Eingabe / 1M', 'Input / 1M', 'Entrée / 1M', 'Entrada / 1M', '入力 / 1M', 'Entrada / 1M'],
  outputPrice: ['Output / 1M', 'Ausgabe / 1M', 'Output / 1M', 'Sortie / 1M', 'Salida / 1M', '出力 / 1M', 'Saída / 1M'],
  cachedPrice: ['Cached / 1M', 'Cache / 1M', 'Cache / 1M', 'Cache / 1M', 'Caché / 1M', 'キャッシュ / 1M', 'Cache / 1M'],
  saved: ['Saved', 'Gespeichert', 'Salvato', 'Enregistré', 'Guardado', '保存しました', 'Guardado'],
  unsavedChanges: ['Unsaved changes', 'Nicht gespeicherte Änderungen', 'Modifiche non salvate', 'Modifications non enregistrées', 'Cambios sin guardar', '未保存の変更', 'Alterações não guardadas'],
  synchronized: ['Feed refresh started.', 'Feed-Aktualisierung gestartet.', 'Aggiornamento feed avviato.', 'Actualisation lancée.', 'Actualización iniciada.', '更新を開始しました。', 'Atualização iniciada.'],
  addTitle: ['Add to Synthesis', 'Zu Synthesis hinzufügen', 'Aggiungi a Synthesis', 'Ajouter à Synthesis', 'Añadir a Synthesis', 'Synthesisに追加', 'Adicionar ao Synthesis'],
  addHelp: ['Paste a YouTube video URL, channel handle or channel ID.', 'YouTube-Video-URL, Handle oder Kanal-ID einfügen.', 'Incolla URL video, handle o ID canale YouTube.', 'Collez une URL, un handle ou un ID de chaîne YouTube.', 'Pega una URL, handle o ID de canal de YouTube.', 'YouTube動画URL、ハンドル、チャンネルIDを貼り付けます。', 'Cole um URL, handle ou ID de canal do YouTube.'],
  cancel: ['Cancel', 'Abbrechen', 'Annulla', 'Annuler', 'Cancelar', 'キャンセル', 'Cancelar'],
  queuedToast: ['Added to the processing queue.', 'Zur Warteschlange hinzugefügt.', 'Aggiunto alla coda di elaborazione.', 'Ajouté à la file de traitement.', 'Añadido a la cola.', '処理キューに追加しました。', 'Adicionado à fila.'],
  channelAdded: ['Channel subscribed.', 'Kanal abonniert.', 'Canale aggiunto.', 'Chaîne ajoutée.', 'Canal añadido.', 'チャンネルを追加しました。', 'Canal adicionado.'],
  loading: ['Loading…', 'Laden…', 'Caricamento…', 'Chargement…', 'Cargando…', '読み込み中…', 'A carregar…'],
} as const;

export type MessageKey = keyof typeof m;

export function translate(language: Language, key: MessageKey, values: Record<string, string | number> = {}): string {
  let result: string = m[key][order.indexOf(language)] || m[key][0];
  for (const [name, value] of Object.entries(values)) result = result.replaceAll(`{${name}}`, String(value));
  return result;
}

export function detectBrowserLanguage(languages: readonly string[] = navigator.languages): Language {
  const map: Record<string, Language> = { en: 'English', de: 'German', it: 'Italian', fr: 'French', es: 'Spanish', ja: 'Japanese', pt: 'Portuguese' };
  for (const locale of languages) {
    const match = map[locale.toLowerCase().split('-')[0]];
    if (match) return match;
  }
  return 'English';
}

export function localeFor(language: Language): string {
  return ({ English: 'en', German: 'de', Italian: 'it', French: 'fr', Spanish: 'es', Japanese: 'ja', Portuguese: 'pt' })[language];
}

export function parseRoute(hash: string): { page: 'feed' | 'detail' | 'settings'; id?: string } {
  if (hash.startsWith('#/video/')) return { page: 'detail', id: hash.slice(8) };
  if (hash === '#/settings') return { page: 'settings' };
  return { page: 'feed' };
}

export { m as messages };
