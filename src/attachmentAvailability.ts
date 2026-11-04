/**
 * What an attachment list shows for a file that is (or is not) on the device:
 * an icon, a tooltip and the pin action, in all languages Haven speaks. Apps
 * render the result in their own components, so TeamEdit, Vega, CRM and the
 * others mark "only on the server", "pinned" and download progress the same
 * way without translating anything themselves.
 *
 * Input is one row of {@link MindooDBAppAttachmentApi.availability} (or an
 * {@link MindooDBAppAttachmentApi.onAvailabilityChange} event) plus the
 * database's {@link MindooDBAppDatabaseInfo.attachmentStorage}.
 */
import { HAVEN_APP_LANDING_LOCALES, resolveHavenAppLandingLocale } from "./landing";
import type {
  MindooDBAppAttachmentAvailability,
  MindooDBAppAttachmentStorage,
} from "./types";

type Locale = (typeof HAVEN_APP_LANDING_LOCALES)[number];

const EN = {
  remote: "Only on the server. Opening it needs a connection.",
  local: "On this device",
  pinned: "Kept on this device, also offline",
  queued: "Waiting to be downloaded",
  downloading: "Downloading: {done} of {total}",
  error: "Download failed, retried on the next sync: {reason}",
  pin: "Keep available offline",
  unpin: "Stop keeping offline",
};

type Strings = typeof EN;

const STRINGS = {
  en: EN,
  de: {
    remote: "Nur auf dem Server. Zum Öffnen ist eine Verbindung nötig.",
    local: "Auf diesem Gerät",
    pinned: "Bleibt auf diesem Gerät, auch offline",
    queued: "Wartet auf den Download",
    downloading: "Wird geladen: {done} von {total}",
    error: "Download fehlgeschlagen, neuer Versuch beim nächsten Sync: {reason}",
    pin: "Offline verfügbar machen",
    unpin: "Nicht mehr offline halten",
  },
  es: {
    remote: "Solo en el servidor. Para abrirlo necesitas conexión.",
    local: "En este dispositivo",
    pinned: "Se guarda en este dispositivo, también sin conexión",
    queued: "Esperando la descarga",
    downloading: "Descargando: {done} de {total}",
    error: "La descarga falló; se reintentará en la próxima sincronización: {reason}",
    pin: "Mantener disponible sin conexión",
    unpin: "Dejar de mantener sin conexión",
  },
  fr: {
    remote: "Uniquement sur le serveur. Une connexion est nécessaire pour l’ouvrir.",
    local: "Sur cet appareil",
    pinned: "Conservé sur cet appareil, même hors ligne",
    queued: "En attente de téléchargement",
    downloading: "Téléchargement : {done} sur {total}",
    error: "Échec du téléchargement, nouvel essai à la prochaine synchronisation : {reason}",
    pin: "Rendre disponible hors ligne",
    unpin: "Ne plus conserver hors ligne",
  },
  it: {
    remote: "Solo sul server. Per aprirlo serve una connessione.",
    local: "Su questo dispositivo",
    pinned: "Resta su questo dispositivo, anche offline",
    queued: "In attesa del download",
    downloading: "Download in corso: {done} di {total}",
    error: "Download non riuscito, nuovo tentativo alla prossima sincronizzazione: {reason}",
    pin: "Rendi disponibile offline",
    unpin: "Non tenere più offline",
  },
  nb: {
    remote: "Bare på serveren. Du trenger tilkobling for å åpne den.",
    local: "På denne enheten",
    pinned: "Beholdes på denne enheten, også uten nett",
    queued: "Venter på nedlasting",
    downloading: "Laster ned: {done} av {total}",
    error: "Nedlastingen mislyktes, prøves igjen ved neste synkronisering: {reason}",
    pin: "Gjør tilgjengelig uten nett",
    unpin: "Ikke behold uten nett lenger",
  },
  nl: {
    remote: "Alleen op de server. Om het te openen heb je verbinding nodig.",
    local: "Op dit apparaat",
    pinned: "Blijft op dit apparaat, ook offline",
    queued: "Wacht op download",
    downloading: "Downloaden: {done} van {total}",
    error: "Download mislukt, nieuwe poging bij de volgende synchronisatie: {reason}",
    pin: "Offline beschikbaar maken",
    unpin: "Niet meer offline bewaren",
  },
  pl: {
    remote: "Tylko na serwerze. Do otwarcia potrzebujesz połączenia.",
    local: "Na tym urządzeniu",
    pinned: "Zostaje na tym urządzeniu, także offline",
    queued: "Czeka na pobranie",
    downloading: "Pobieranie: {done} z {total}",
    error: "Pobieranie nie powiodło się, ponowna próba przy następnej synchronizacji: {reason}",
    pin: "Udostępnij offline",
    unpin: "Nie przechowuj już offline",
  },
} as const satisfies Record<Locale, Strings>;

/**
 * Icon for a row; map it onto the app's icon set:
 *
 * - `"cloud"`: only on the server
 * - `"pin"`: pinned and on the device
 * - `"download"`: queued or downloading (draw `progress` as a ring or bar)
 * - `"error"`: the download failed
 * - `null`: nothing to mark (on the device and not pinned, or a database that
 *   keeps all attachments locally)
 */
export type MindooDBAppAttachmentAvailabilityIcon = "cloud" | "pin" | "download" | "error" | null;

export interface MindooDBAppAttachmentAvailabilityDisplay {
  icon: MindooDBAppAttachmentAvailabilityIcon;
  /** Tooltip / accessible label for the icon. */
  label: string;
  /** 0..1 while queued or downloading, otherwise `null`. */
  progress: number | null;
  /**
   * The pin action for a row menu, or `null` where pinning is pointless or
   * impossible (`attachmentStorage` other than `"onDemand"`).
   */
  action: { kind: "pin" | "unpin"; label: string } | null;
}

function format(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

/** `1.5 MB`-style size in the given language. */
export function formatAttachmentBytes(bytes: number, locale = "en"): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: unit === 0 || value >= 10 ? 0 : 1 }).format(
    value,
  );
  return `${number} ${units[unit]}`;
}

/**
 * How to show one attachment's availability in a list row.
 *
 * @param locale BCP 47 tag of the UI language (e.g. `session.locale`); tags
 *   Haven does not speak fall back to English.
 */
export function describeAttachmentAvailability(
  availability: MindooDBAppAttachmentAvailability,
  storage: MindooDBAppAttachmentStorage | undefined,
  locale = "en",
): MindooDBAppAttachmentAvailabilityDisplay {
  const lang = resolveHavenAppLandingLocale(locale);
  const strings: Strings = STRINGS[lang];
  const pinnable = storage === "onDemand";
  const action = pinnable
    ? availability.pinned
      ? { kind: "unpin" as const, label: strings.unpin }
      : { kind: "pin" as const, label: strings.pin }
    : null;
  const progress =
    availability.size > 0 ? Math.min(1, Math.max(0, availability.bytesLocal / availability.size)) : 0;

  switch (availability.state) {
    case "remote":
      return { icon: "cloud", label: strings.remote, progress: null, action };
    case "queued":
      return { icon: "download", label: strings.queued, progress, action };
    case "downloading":
      return {
        icon: "download",
        label: format(strings.downloading, {
          done: formatAttachmentBytes(availability.bytesLocal, lang),
          total: formatAttachmentBytes(availability.size, lang),
        }),
        progress,
        action,
      };
    case "error":
      return {
        icon: "error",
        label: format(strings.error, { reason: availability.error ?? "" }).replace(/\s*:\s*$/, ""),
        progress: null,
        action,
      };
    default:
      if (availability.pinned && pinnable) {
        return { icon: "pin", label: strings.pinned, progress: null, action };
      }
      return { icon: null, label: strings.local, progress: null, action };
  }
}
