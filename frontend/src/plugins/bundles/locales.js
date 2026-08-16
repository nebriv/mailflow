// The plugin's own translations, in its own i18next namespace.
//
// Registered at runtime rather than added to src/locales/*.json. Those files are core, and every
// key added to them lands in seven locale files — well past the 50-line core-diff budget INV-22
// sets, for strings that belong to a plugin that should be deletable by deleting its directory.
// i18next namespaces exist for exactly this, and the locale test suites are unaffected: Suite 1
// flags DEAD keys in core locale files (this adds none) and Suite 4 flags hardcoded JSX literals
// (t() satisfies it).

import i18n from '../../i18n.js';

export const NS = 'bundles';

const en = {
  label: {
    newsletters: 'Newsletters',
    promotions: 'Promotions',
    notifications: 'Notifications',
    social: 'Social',
  },
  sweep: {
    clearSeen: 'Clear {{count}} seen',
    nothingSeen: 'Nothing seen yet',
    hint: 'Files these into the reading feed — nothing is deleted',
    hintDisabled: 'Scroll to mark messages seen',
    filesInto: 'Sweeping files these into {{label}} — nothing is deleted.',
  },
  divider: {
    seen: '{{count}} seen',
    adjust: '{{count}} messages seen — drag to adjust',
  },
  keep: {
    add: 'Keep through the next sweeps',
    remove: 'Release keep',
    kept: 'Kept — survives the next few sweeps',
    pinned: 'Pinned — survives every sweep',
  },
  reveal: {
    hide: 'Hide swept',
    show_one: '{{count}} swept bundle — show',
    show_other: '{{count}} swept bundles — show',
    empty: 'Nothing filed here yet.',
    loading: 'Loading…',
    sweptAt: 'swept {{when}}',
    neverSwept: 'never swept',
  },
  undo: {
    filed: '{{count}} filed into {{label}}',
    action: 'Undo',
    dismiss: 'Dismiss',
  },
  noSubject: '(no subject)',
};

const de = {
  label: { newsletters: 'Newsletter', promotions: 'Werbung', notifications: 'Benachrichtigungen', social: 'Soziales' },
  sweep: {
    clearSeen: '{{count}} gesehene löschen',
    nothingSeen: 'Noch nichts gesehen',
    hint: 'Legt diese im Lesebereich ab — nichts wird gelöscht',
    hintDisabled: 'Scrollen, um Nachrichten als gesehen zu markieren',
    filesInto: 'Das Wischen legt diese in {{label}} ab — nichts wird gelöscht.',
  },
  divider: { seen: '{{count}} gesehen', adjust: '{{count}} Nachrichten gesehen — zum Anpassen ziehen' },
  keep: {
    add: 'Für die nächsten Durchgänge behalten',
    remove: 'Behalten aufheben',
    kept: 'Behalten — übersteht die nächsten Durchgänge',
    pinned: 'Angeheftet — übersteht jeden Durchgang',
  },
  reveal: {
    hide: 'Abgelegte ausblenden',
    show_one: '{{count}} abgelegtes Bündel — anzeigen',
    show_other: '{{count}} abgelegte Bündel — anzeigen',
    empty: 'Hier wurde noch nichts abgelegt.',
    loading: 'Wird geladen…',
    sweptAt: 'abgelegt {{when}}',
    neverSwept: 'nie abgelegt',
  },
  undo: { filed: '{{count}} in {{label}} abgelegt', action: 'Rückgängig', dismiss: 'Schließen' },
  noSubject: '(kein Betreff)',
};

const fr = {
  label: { newsletters: 'Infolettres', promotions: 'Promotions', notifications: 'Notifications', social: 'Social' },
  sweep: {
    clearSeen: 'Effacer {{count}} vus',
    nothingSeen: 'Rien vu pour l’instant',
    hint: 'Classe ces messages dans le flux de lecture — rien n’est supprimé',
    hintDisabled: 'Faites défiler pour marquer les messages comme vus',
    filesInto: 'Le balayage classe ces messages dans {{label}} — rien n’est supprimé.',
  },
  divider: { seen: '{{count}} vus', adjust: '{{count}} messages vus — faites glisser pour ajuster' },
  keep: {
    add: 'Conserver pour les prochains balayages',
    remove: 'Ne plus conserver',
    kept: 'Conservé — survit aux prochains balayages',
    pinned: 'Épinglé — survit à tous les balayages',
  },
  reveal: {
    hide: 'Masquer les classés',
    show_one: '{{count}} lot classé — afficher',
    show_other: '{{count}} lots classés — afficher',
    empty: 'Rien n’a encore été classé ici.',
    loading: 'Chargement…',
    sweptAt: 'classé {{when}}',
    neverSwept: 'jamais balayé',
  },
  undo: { filed: '{{count}} classés dans {{label}}', action: 'Annuler', dismiss: 'Fermer' },
  noSubject: '(sans objet)',
};

const es = {
  label: { newsletters: 'Boletines', promotions: 'Promociones', notifications: 'Notificaciones', social: 'Social' },
  sweep: {
    clearSeen: 'Borrar {{count}} vistos',
    nothingSeen: 'Nada visto todavía',
    hint: 'Archiva estos en el área de lectura — no se elimina nada',
    hintDisabled: 'Desplázate para marcar mensajes como vistos',
    filesInto: 'El barrido archiva estos en {{label}} — no se elimina nada.',
  },
  divider: { seen: '{{count}} vistos', adjust: '{{count}} mensajes vistos — arrastra para ajustar' },
  keep: {
    add: 'Conservar durante los próximos barridos',
    remove: 'Dejar de conservar',
    kept: 'Conservado — sobrevive a los próximos barridos',
    pinned: 'Fijado — sobrevive a todos los barridos',
  },
  reveal: {
    hide: 'Ocultar archivados',
    show_one: '{{count}} grupo archivado — mostrar',
    show_other: '{{count}} grupos archivados — mostrar',
    empty: 'Aquí todavía no se ha archivado nada.',
    loading: 'Cargando…',
    sweptAt: 'archivado {{when}}',
    neverSwept: 'nunca barrido',
  },
  undo: { filed: '{{count}} archivados en {{label}}', action: 'Deshacer', dismiss: 'Descartar' },
  noSubject: '(sin asunto)',
};

const it = {
  label: { newsletters: 'Newsletter', promotions: 'Promozioni', notifications: 'Notifiche', social: 'Social' },
  sweep: {
    clearSeen: 'Cancella {{count}} visti',
    nothingSeen: 'Niente visto finora',
    hint: 'Archivia questi nel flusso di lettura — non viene eliminato nulla',
    hintDisabled: 'Scorri per segnare i messaggi come visti',
    filesInto: 'La pulizia archivia questi in {{label}} — non viene eliminato nulla.',
  },
  divider: { seen: '{{count}} visti', adjust: '{{count}} messaggi visti — trascina per regolare' },
  keep: {
    add: 'Conserva per le prossime pulizie',
    remove: 'Non conservare più',
    kept: 'Conservato — sopravvive alle prossime pulizie',
    pinned: 'Fissato — sopravvive a ogni pulizia',
  },
  reveal: {
    hide: 'Nascondi archiviati',
    show_one: '{{count}} gruppo archiviato — mostra',
    show_other: '{{count}} gruppi archiviati — mostra',
    empty: 'Qui non è ancora stato archiviato nulla.',
    loading: 'Caricamento…',
    sweptAt: 'archiviato {{when}}',
    neverSwept: 'mai pulito',
  },
  undo: { filed: '{{count}} archiviati in {{label}}', action: 'Annulla', dismiss: 'Chiudi' },
  noSubject: '(nessun oggetto)',
};

const ru = {
  label: { newsletters: 'Рассылки', promotions: 'Промоакции', notifications: 'Уведомления', social: 'Соцсети' },
  sweep: {
    clearSeen: 'Очистить просмотренные ({{count}})',
    nothingSeen: 'Пока ничего не просмотрено',
    hint: 'Помещает их в ленту чтения — ничего не удаляется',
    hintDisabled: 'Прокрутите, чтобы отметить письма просмотренными',
    filesInto: 'Очистка помещает их в «{{label}}» — ничего не удаляется.',
  },
  divider: { seen: 'просмотрено: {{count}}', adjust: 'просмотрено писем: {{count}} — потяните, чтобы изменить' },
  keep: {
    add: 'Оставить на несколько очисток',
    remove: 'Не оставлять',
    kept: 'Оставлено — переживёт ближайшие очистки',
    pinned: 'Закреплено — переживёт любую очистку',
  },
  reveal: {
    hide: 'Скрыть убранные',
    show_one: 'Убранная группа: {{count}} — показать',
    show_other: 'Убранных групп: {{count}} — показать',
    empty: 'Сюда пока ничего не помещено.',
    loading: 'Загрузка…',
    sweptAt: 'очищено {{when}}',
    neverSwept: 'ни разу не очищалось',
  },
  undo: { filed: 'Помещено в «{{label}}»: {{count}}', action: 'Отменить', dismiss: 'Закрыть' },
  noSubject: '(без темы)',
};

const zhCN = {
  label: { newsletters: '订阅邮件', promotions: '促销', notifications: '通知', social: '社交' },
  sweep: {
    clearSeen: '清理 {{count}} 封已看',
    nothingSeen: '尚未查看任何邮件',
    hint: '将它们归入阅读流——不会删除任何内容',
    hintDisabled: '滚动以将邮件标记为已看',
    filesInto: '清理会将它们归入{{label}}——不会删除任何内容。',
  },
  divider: { seen: '已看 {{count}} 封', adjust: '已看 {{count}} 封邮件——拖动可调整' },
  keep: {
    add: '在接下来几次清理中保留',
    remove: '取消保留',
    kept: '已保留——可留存接下来几次清理',
    pinned: '已置顶——可留存每次清理',
  },
  reveal: {
    hide: '隐藏已归档',
    show_one: '{{count}} 个已清理分组——显示',
    show_other: '{{count}} 个已清理分组——显示',
    empty: '这里还没有归档任何内容。',
    loading: '加载中…',
    sweptAt: '{{when}} 已清理',
    neverSwept: '从未清理',
  },
  undo: { filed: '已将 {{count}} 封归入{{label}}', action: '撤销', dismiss: '关闭' },
  noSubject: '（无主题）',
};

// `deep` merge, `overwrite` false — never clobber anything core defined.
for (const [lng, resources] of Object.entries({ en, de, fr, es, it, ru, zhCN })) {
  i18n.addResourceBundle(lng, NS, resources, true, false);
}
