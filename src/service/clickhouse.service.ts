import { ClickHouse } from 'clickhouse';
import got from 'got';
import { ReadStream } from 'fs';

export default class ClickHouseService {
  private static readonly CLICK_HOUSE_URL = 'http://localhost';
  private static readonly CLICK_HOUSE_PORT = 8123;

  private clickhouse: ClickHouse;
  private static singletonInstance: ClickHouseService;

  static get instance(): ClickHouseService {
    return this.singletonInstance || (this.singletonInstance = new this());
  }

  private constructor() {
    this.connection();
  }

  public query(query: string): Promise<Object[]> {
    return this.clickhouse.query(query).toPromise();
  }

  public post(query: string, data: ReadStream) {
    return got(`${ClickHouseService.CLICK_HOUSE_URL}:${ClickHouseService.CLICK_HOUSE_PORT}/?query=${query}`, {
      method: 'POST',
      body: data,
    });
  }

  private connection(): void {
    this.clickhouse = new ClickHouse({
      url: ClickHouseService.CLICK_HOUSE_URL,
      port: ClickHouseService.CLICK_HOUSE_PORT,
      username: 'default',
      password: '',
      basicAuth: null,
      isUseGzip: true,
      format: 'csv',
      config: {
        session_id: 'session_id if neeed',
        session_timeout: 60,
        output_format_json_quote_64bit_integers: 0,
        enable_http_compression: 0,
        database: 'juno',
        max_partitions_per_insert_block: 1000,
      },
    });
  }
}
