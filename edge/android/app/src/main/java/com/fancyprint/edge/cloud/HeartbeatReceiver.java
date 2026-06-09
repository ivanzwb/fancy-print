/*
 * HeartbeatReceiver is intentionally removed.
 *
 * The heartbeat is now handled exclusively by EdgeDaemonService.onStartCommand()
 * via ACTION_HEARTBEAT / ACTION_HEALTH_HEARTBEAT alarms scheduled directly against
 * EdgeDaemonService.class. CloudConnectorService is NOT an Android Service and
 * cannot be started via startService().
 *
 * See EdgeDaemonService.java onStartCommand() for the heartbeat implementation.
 */