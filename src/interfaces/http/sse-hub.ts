import type http from 'node:http';
export class SseHub {
  private readonly clients = new Set<http.ServerResponse>();
  add(response: http.ServerResponse): void {
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    response.write('retry: 2000\n\n');
    this.clients.add(response);
    response.on('close', () => this.clients.delete(response));
  }
  publish(event: string, data: unknown): void {
    const encoded = JSON.stringify(data);
    for (const client of this.clients) {
      try {
        client.write(`event: ${event}\ndata: ${encoded}\n\n`);
      } catch {
        this.clients.delete(client);
      }
    }
  }
  close(): void {
    for (const client of this.clients) client.end();
    this.clients.clear();
  }
}
