import { ClickHouse } from 'clickhouse';

export default class ClickHouseService {
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

  private connection(): void {
    this.clickhouse = new ClickHouse({
      url: 'http://localhost',
      port: 8123,
      basicAuth: {
        username: 'default',
        password: '',
      },
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
