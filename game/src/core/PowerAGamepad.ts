/** Lecture USB directe du PowerA 20d6:a713, en complément de l'API Gamepad. */
export interface PadSnapshot {
  index: number;
  id: string;
  mapping: string;
  connected: boolean;
  axes: readonly number[];
  buttons: readonly { value: number; pressed: boolean }[];
}

// WebHID n'est pas encore déclaré dans lib.dom de TypeScript.
interface HIDInputEvent extends Event { reportId: number; data: DataView }
interface HIDDevice extends EventTarget {
  vendorId: number;
  productId: number;
  opened: boolean;
  open(): Promise<void>;
  close(): Promise<void>;
}
interface HIDConnectionEvent extends Event { device: HIDDevice }
interface HID extends EventTarget {
  getDevices(): Promise<HIDDevice[]>;
  requestDevice(options: { filters: { vendorId: number; productId: number }[] }): Promise<HIDDevice[]>;
}

function isPowerA(device: HIDDevice): boolean {
  return device.vendorId === 0x20d6 && device.productId === 0xa713;
}

/** Format confirmé par le descripteur HID de la manette branchée au Mac :
 * 14 boutons sur 2 octets, hat sur l'octet 2, sticks X/Y/Z/Rz aux octets 3 à 6.
 * Aucun identifiant de rapport ; le dernier octet du rapport est constant.
 */
export function decodePowerAReport(data: DataView, reportId: number): PadSnapshot | null {
  if (reportId !== 0 || data.byteLength < 7) return null;
  const bits = data.getUint16(0, true);
  return {
    index: -1,
    id: 'PowerA NSW Wired controller USB (20d6:a713)',
    mapping: '',
    connected: true,
    axes: Array.from({ length: 4 }, (_, i) => {
      const value = data.getUint8(3 + i) - 128;
      return value / (value < 0 ? 128 : 127);
    }),
    buttons: Array.from({ length: 14 }, (_, i) => {
      const pressed = (bits & (1 << i)) !== 0;
      return { value: Number(pressed), pressed };
    }),
  };
}

export class PowerAGamepad {
  private readonly hid = (navigator as Navigator & { hid?: HID }).hid;
  private device: HIDDevice | null = null;
  private disposed = false;
  private requestVersion = 0;
  private openedAt: number | null = null;
  private receivedReports = 0;
  snapshot: PadSnapshot | null = null;
  private message = 'PowerA USB : cliquez sur « Connecter la manette ».';

  get status(): string {
    if (this.openedAt !== null && this.receivedReports === 0 && Date.now() - this.openedAt >= 3000) {
      return 'Connexion USB ouverte, mais aucune donnée reçue. Débranchez puis rebranchez la manette, puis cliquez sur « Connecter la manette ».';
    }
    return this.message;
  }

  constructor() {
    this.hid?.addEventListener('connect', this.onConnect);
    this.hid?.addEventListener('disconnect', this.onDisconnect);
    // Sans boîte de dialogue : seuls les appareils déjà autorisés sont repris.
    void this.restore();
  }

  private async restore(): Promise<void> {
    try {
      const devices = await this.hid?.getDevices();
      const device = devices?.find(isPowerA);
      if (device && !this.disposed && !this.device) await this.attach(device);
    } catch {
      // L'utilisateur pourra réessayer explicitement avec le bouton de connexion.
    }
  }

  /** À appeler directement depuis un clic, requis par le sélecteur de Chrome. */
  async connect(): Promise<void> {
    if (!this.hid) {
      this.message = 'Connexion USB indisponible : ouvrez le jeu dans Chrome sur localhost ou HTTPS.';
      return;
    }
    try {
      // Un handle ouvert ne garantit pas la réception de données. Un nouveau clic
      // réarme réellement l'écoute, au lieu de laisser une connexion muette intacte.
      if (this.device) {
        const device = this.device;
        this.detach();
        if (device.opened) await device.close();
        await this.attach(device);
        return;
      }
      const devices = await this.hid.requestDevice({
        filters: [{ vendorId: 0x20d6, productId: 0xa713 }],
      });
      const device = devices.find(isPowerA);
      if (device) await this.attach(device);
      else this.message = 'Connexion annulée. Choisissez « NSW Wired controller » pour connecter la PowerA.';
    } catch (error) {
      this.message = `Connexion impossible : ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async attach(device: HIDDevice): Promise<void> {
    const version = ++this.requestVersion;
    if (!device.opened) await device.open();
    if (this.disposed || version !== this.requestVersion) {
      if (device !== this.device) await device.close();
      return;
    }
    this.device?.removeEventListener('inputreport', this.onInput);
    this.device = device;
    this.snapshot = null;
    this.receivedReports = 0;
    this.openedAt = Date.now();
    device.addEventListener('inputreport', this.onInput);
    this.message = 'Connexion USB ouverte. En attente des commandes : bougez le stick ou appuyez sur une gâchette.';
  }

  private onInput = (event: Event): void => {
    const { data, reportId } = event as HIDInputEvent;
    this.receivedReports++;
    const snapshot = decodePowerAReport(data, reportId);
    if (!snapshot) {
      this.snapshot = null;
      this.message = `Données USB reçues, format non reconnu (rapport ${reportId}, ${data.byteLength} octets).`;
      return;
    }
    this.snapshot = snapshot;
    this.message = 'Manette PowerA connectée';
  };

  private onConnect = (event: Event): void => {
    const { device } = event as HIDConnectionEvent;
    if (isPowerA(device)) {
      void this.attach(device).catch(() => { this.message = 'Reconnexion impossible. Cliquez sur « Connecter la manette ».'; });
    }
  };

  private onDisconnect = (event: Event): void => {
    if ((event as HIDConnectionEvent).device !== this.device) return;
    this.detach();
    this.message = 'PowerA USB débranchée.';
  };

  private detach(): void {
    this.requestVersion++;
    this.device?.removeEventListener('inputreport', this.onInput);
    this.device = null;
    this.snapshot = null;
    this.openedAt = null;
    this.receivedReports = 0;
  }

  dispose(): void {
    this.disposed = true;
    this.requestVersion++;
    this.hid?.removeEventListener('connect', this.onConnect);
    this.hid?.removeEventListener('disconnect', this.onDisconnect);
    this.device?.removeEventListener('inputreport', this.onInput);
    void this.device?.close().catch(() => {});
    this.device = null;
    this.snapshot = null;
    this.openedAt = null;
  }
}
