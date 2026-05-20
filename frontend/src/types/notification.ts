interface Notification {
  message: string;
  type: 'success' | 'error' | 'info' | 'undefined';
}

interface PushDiagnostics {
  supported: boolean;
  permission: NotificationPermission | 'unsupported';
  invalidEndpoint: boolean;
}

export type { Notification, PushDiagnostics };