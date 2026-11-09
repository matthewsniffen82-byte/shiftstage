import * as destinations from '../../src/lib/dancr/notification-email-path.ts';

// Sender fixtures exercise the email destination independently of the one-time credential store.
export function notificationEmailModules(origin) {
  return {
    './notification-email-path': destinations,
    './notification-email-link': { notificationEmailUrl: async (_client, recipient, path) => {
      if (destinations.notificationDestinationRole(path) !== recipient.role) throw Error('Unexpected recipient for '+path);
      return origin+path;
    } },
  };
}
