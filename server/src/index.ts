import type { Server } from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { prisma } from './db/prisma';

async function start(): Promise<void> {
  // Fail fast: a server that cannot reach its database should not accept traffic.
  await prisma.$connect();

  const app = createApp();

  // 0.0.0.0 so receptionists on the local network can reach the app.
  const server: Server = app.listen(env.PORT, '0.0.0.0', () => {
    // eslint-disable-next-line no-console
    console.log(
      `hotel-booking-dispatch server đang chạy tại http://localhost:${env.PORT} (${env.NODE_ENV})`,
    );
  });

  registerShutdown(server);
}

function registerShutdown(server: Server): void {
  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;

    // eslint-disable-next-line no-console
    console.log(`\nNhận tín hiệu ${signal}, đang tắt server...`);

    // Stop accepting connections, then release the database handle.
    server.close((closeError) => {
      void prisma
        .$disconnect()
        .catch(() => undefined)
        .finally(() => {
          process.exit(closeError ? 1 : 0);
        });
    });

    // Do not hang forever on lingering keep-alive sockets.
    const forceExit = setTimeout(() => {
      // eslint-disable-next-line no-console
      console.error('Tắt server quá thời gian chờ, buộc thoát.');
      process.exit(1);
    }, 10_000);
    forceExit.unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('Không thể khởi động server:', error);
  process.exit(1);
});
