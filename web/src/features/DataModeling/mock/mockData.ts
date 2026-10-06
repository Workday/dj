import type { DbtProject } from '@shared/dbt/types';

/**
 * Mock data for development and testing purposes
 * Simulates a dbt project with realistic models and columns
 */
export const createMockProject = (): DbtProject =>
  ({
    name: 'mock_data_platform',
    manifest: {
      nodes: {
        // === STAGING LAYER MODELS (5+ models) ===
        'model.data_platform.stg__ibp__aws__raw_cur_data': {
          name: 'stg__ibp__aws__raw_cur_data',
          group: 'ibp',
          columns: {
            // Dimensions (6 columns)
            lineitem_usagestartdate: {
              data_type: 'timestamp',
              description: 'Usage start date for billing line item',
              meta: { type: 'dim' },
            },
            lineitem_productcode: {
              data_type: 'varchar',
              description: 'AWS product code for the service',
              meta: { type: 'dim' },
            },
            lineitem_usagetype: {
              data_type: 'varchar',
              description: 'Type of usage for the service',
              meta: { type: 'dim' },
            },
            lineitem_operation: {
              data_type: 'varchar',
              description: 'Operation performed',
              meta: { type: 'dim' },
            },
            lineitem_availabilityzone: {
              data_type: 'varchar',
              description: 'AWS availability zone',
              meta: { type: 'dim' },
            },
            lineitem_resourceid: {
              data_type: 'varchar',
              description: 'Resource identifier',
              meta: { type: 'dim' },
            },

            // Facts (4 columns)
            lineitem_blendedcost: {
              data_type: 'string',
              description: 'Blended cost for the line item',
              meta: { type: 'fct' },
            },
            lineitem_unblendedcost: {
              data_type: 'string',
              description: 'Unblended cost for the line item',
              meta: { type: 'fct' },
            },
            lineitem_usageamount: {
              data_type: 'string',
              description: 'Usage amount for the line item',
              meta: { type: 'fct' },
            },
            lineitem_normalizationfactor: {
              data_type: 'string',
              description: 'Normalization factor',
              meta: { type: 'fct' },
            },
          },
        },

        'model.data_platform.stg__ml__metrics__model_deployments': {
          name: 'stg__ml__metrics__model_deployments',
          group: 'ml',
          columns: {
            // Dimensions (7 columns)
            lineitem_usagestartdate: {
              data_type: 'timestamp',
              description: 'Usage start date for billing line item',
              meta: { type: 'dim' },
            },
            deployment_id: {
              data_type: 'varchar',
              description: 'Unique deployment identifier',
              meta: { type: 'dim' },
            },
            model_name: {
              data_type: 'varchar',
              description: 'Name of the deployed model',
              meta: { type: 'dim' },
            },
            model_version: {
              data_type: 'varchar',
              description: 'Version of the deployed model',
              meta: { type: 'dim' },
            },
            cluster_name: {
              data_type: 'varchar',
              description: 'Kubernetes cluster name',
              meta: { type: 'dim' },
            },
            namespace: {
              data_type: 'varchar',
              description: 'Kubernetes namespace',
              meta: { type: 'dim' },
            },
            environment: {
              data_type: 'varchar',
              description: 'Deployment environment',
              meta: { type: 'dim' },
            },
            created_at: {
              data_type: 'timestamp',
              description: 'Deployment creation timestamp',
              meta: { type: 'dim' },
            },

            // Facts (5 columns)
            replica_count: {
              data_type: 'integer',
              description: 'Number of deployment replicas',
              meta: { type: 'fct' },
            },
            cpu_request: {
              data_type: 'string',
              description: 'CPU request in cores',
              meta: { type: 'fct' },
            },
            memory_request_mb: {
              data_type: 'bigint',
              description: 'Memory request in megabytes',
              meta: { type: 'fct' },
            },
            gpu_count: {
              data_type: 'integer',
              description: 'Number of GPUs requested',
              meta: { type: 'fct' },
            },
            storage_gb: {
              data_type: 'integer',
              description: 'Storage allocation in GB',
              meta: { type: 'fct' },
            },
          },
        },

        'model.data_platform.stg__sales__inventory__product_metrics': {
          name: 'stg__sales__inventory__product_metrics',
          group: 'sales',
          columns: {
            // Dimensions (6 columns)
            pod_name: {
              data_type: 'varchar',
              description: 'Kubernetes pod name',
              meta: { type: 'dim' },
            },
            namespace: {
              data_type: 'varchar',
              description: 'Kubernetes namespace',
              meta: { type: 'dim' },
            },
            cluster_name: {
              data_type: 'varchar',
              description: 'Kubernetes cluster name',
              meta: { type: 'dim' },
            },
            container_name: {
              data_type: 'varchar',
              description: 'Container name within the pod',
              meta: { type: 'dim' },
            },
            node_name: {
              data_type: 'varchar',
              description: 'Kubernetes node name',
              meta: { type: 'dim' },
            },
            metric_timestamp: {
              data_type: 'timestamp',
              description: 'Metrics collection timestamp',
              meta: { type: 'dim' },
            },

            // Facts (6 columns)
            cpu_usage_cores: {
              data_type: 'string',
              description: 'CPU usage in cores',
              meta: { type: 'fct' },
            },
            memory_usage_bytes: {
              data_type: 'bigint',
              description: 'Memory usage in bytes',
              meta: { type: 'fct' },
            },
            network_rx_bytes: {
              data_type: 'bigint',
              description: 'Network received bytes',
              meta: { type: 'fct' },
            },
            network_tx_bytes: {
              data_type: 'bigint',
              description: 'Network transmitted bytes',
              meta: { type: 'fct' },
            },
            disk_usage_bytes: {
              data_type: 'bigint',
              description: 'Disk usage in bytes',
              meta: { type: 'fct' },
            },
            restart_count: {
              data_type: 'integer',
              description: 'Container restart count',
              meta: { type: 'fct' },
            },
          },
        },

        'model.data_platform.stg__ibp__gcp__billing_export': {
          name: 'stg__ibp__gcp__billing_export',
          group: 'ibp',
          columns: {
            // Dimensions (8 columns)
            billing_account_id: {
              data_type: 'varchar',
              description: 'GCP billing account ID',
              meta: { type: 'dim' },
            },
            project_id: {
              data_type: 'varchar',
              description: 'GCP project identifier',
              meta: { type: 'dim' },
            },
            service_id: {
              data_type: 'varchar',
              description: 'GCP service identifier',
              meta: { type: 'dim' },
            },
            sku_id: {
              data_type: 'varchar',
              description: 'SKU identifier for the service',
              meta: { type: 'dim' },
            },
            location_region: {
              data_type: 'varchar',
              description: 'GCP region location',
              meta: { type: 'dim' },
            },
            usage_start_time: {
              data_type: 'timestamp',
              description: 'Usage start timestamp',
              meta: { type: 'dim' },
            },
            currency: {
              data_type: 'varchar',
              description: 'Billing currency',
              meta: { type: 'dim' },
            },
            export_time: {
              data_type: 'timestamp',
              description: 'Export timestamp',
              meta: { type: 'dim' },
            },

            // Facts (4 columns)
            cost: {
              data_type: 'string',
              description: 'Cost amount in billing currency',
              meta: { type: 'fct' },
            },
            usage_amount: {
              data_type: 'string',
              description: 'Usage amount',
              meta: { type: 'fct' },
            },
            credits_amount: {
              data_type: 'string',
              description: 'Credits applied',
              meta: { type: 'fct' },
            },
            invoice_month: {
              data_type: 'string',
              description: 'Invoice month',
              meta: { type: 'fct' },
            },
          },
        },

        'model.data_platform.stg__analytics__audit__dashboard_queries': {
          name: 'stg__analytics__audit__dashboard_queries',
          group: 'analytics',
          columns: {
            // Dimensions (7 columns)
            query_id: {
              data_type: 'varchar',
              description: 'Unique query identifier',
              meta: { type: 'dim' },
            },
            user_id: {
              data_type: 'varchar',
              description: 'User who executed the query',
              meta: { type: 'dim' },
            },
            project_id: {
              data_type: 'varchar',
              description: 'Lightdash project identifier',
              meta: { type: 'dim' },
            },
            table_name: {
              data_type: 'varchar',
              description: 'Main table queried',
              meta: { type: 'dim' },
            },
            query_type: {
              data_type: 'varchar',
              description: 'Type of query (explore, dashboard, etc.)',
              meta: { type: 'dim' },
            },
            executed_at: {
              data_type: 'timestamp',
              description: 'Query execution timestamp',
              meta: { type: 'dim' },
            },
            status: {
              data_type: 'varchar',
              description: 'Query execution status',
              meta: { type: 'dim' },
            },

            // Facts (5 columns)
            query_duration_ms: {
              data_type: 'bigint',
              description: 'Query execution duration in milliseconds',
              meta: { type: 'fct' },
            },
            rows_returned: {
              data_type: 'bigint',
              description: 'Number of rows returned by the query',
              meta: { type: 'fct' },
            },
            bytes_processed: {
              data_type: 'bigint',
              description: 'Bytes processed during query execution',
              meta: { type: 'fct' },
            },
            cache_hit: {
              data_type: 'boolean',
              description: 'Whether query result came from cache',
              meta: { type: 'fct' },
            },
            error_count: {
              data_type: 'integer',
              description: 'Number of errors encountered',
              meta: { type: 'fct' },
            },
          },
        },

        // === INTERMEDIATE LAYER MODELS (5+ models) ===
        'model.data_platform.int__ibp__aws__billing_hourly_aggregated': {
          name: 'int__ibp__aws__billing_hourly_aggregated',
          group: 'ibp',
          columns: {
            // Dimensions (6 columns)
            usage_hour: {
              data_type: 'timestamp',
              description: 'Hour of usage aggregation',
              meta: { type: 'dim' },
            },
            aws_account_id: {
              data_type: 'varchar',
              description: 'AWS account identifier',
              meta: { type: 'dim' },
            },
            product_code: {
              data_type: 'varchar',
              description: 'AWS service product code',
              meta: { type: 'dim' },
            },
            availability_zone: {
              data_type: 'varchar',
              description: 'AWS availability zone',
              meta: { type: 'dim' },
            },
            resource_type: {
              data_type: 'varchar',
              description: 'Type of AWS resource',
              meta: { type: 'dim' },
            },
            billing_period: {
              data_type: 'varchar',
              description: 'Billing period identifier',
              meta: { type: 'dim' },
            },

            // Facts (6 columns)
            total_cost: {
              data_type: 'string',
              description: 'Total cost for the hour',
              meta: { type: 'fct' },
            },
            usage_quantity: {
              data_type: 'string',
              description: 'Usage quantity for the hour',
              meta: { type: 'fct' },
            },
            blended_rate: {
              data_type: 'string',
              description: 'Blended rate per unit',
              meta: { type: 'fct' },
            },
            unblended_rate: {
              data_type: 'string',
              description: 'Unblended rate per unit',
              meta: { type: 'fct' },
            },
            resource_count: {
              data_type: 'integer',
              description: 'Number of resources',
              meta: { type: 'fct' },
            },
            reserved_instance_savings: {
              data_type: 'string',
              description: 'Savings from reserved instances',
              meta: { type: 'fct' },
            },
          },
        },

        // === MART LAYER MODELS (5+ models) ===
        'model.data_platform.mart__ibp__cloud_cost_summary': {
          name: 'mart__ibp__cloud_cost_summary',
          group: 'ibp',
          columns: {
            // Dimensions (8 columns)
            cost_date: {
              data_type: 'date',
              description: 'Date of cost occurrence',
              meta: { type: 'dim' },
            },
            cloud_provider: {
              data_type: 'varchar',
              description: 'Cloud provider (AWS, GCP, Azure)',
              meta: { type: 'dim' },
            },
            account_id: {
              data_type: 'varchar',
              description: 'Cloud account identifier',
              meta: { type: 'dim' },
            },
            service_category: {
              data_type: 'varchar',
              description: 'Service category (compute, storage, network)',
              meta: { type: 'dim' },
            },
            environment: {
              data_type: 'varchar',
              description: 'Environment (production, staging, development)',
              meta: { type: 'dim' },
            },
            team: {
              data_type: 'varchar',
              description: 'Team responsible for the resources',
              meta: { type: 'dim' },
            },
            cost_center: {
              data_type: 'varchar',
              description: 'Cost center allocation',
              meta: { type: 'dim' },
            },
            business_unit: {
              data_type: 'varchar',
              description: 'Business unit',
              meta: { type: 'dim' },
            },

            // Facts (6 columns)
            total_cost_usd: {
              data_type: 'string',
              description: 'Total cost in USD',
              meta: { type: 'fct' },
            },
            resource_count: {
              data_type: 'integer',
              description: 'Number of resources contributing to cost',
              meta: { type: 'fct' },
            },
            budget_variance: {
              data_type: 'string',
              description: 'Variance from budget',
              meta: { type: 'fct' },
            },
            previous_period_cost: {
              data_type: 'string',
              description: 'Cost from previous period',
              meta: { type: 'fct' },
            },
            cost_per_resource: {
              data_type: 'string',
              description: 'Average cost per resource',
              meta: { type: 'fct' },
            },
            forecasted_monthly_cost: {
              data_type: 'string',
              description: 'Forecasted monthly cost',
              meta: { type: 'fct' },
            },
          },
        },

        // === SEEDS (5+ seeds) ===
        'seed.data_platform.aws_service_mapping': {
          name: 'aws_service_mapping',
          resource_type: 'seed',
          columns: {
            // Dimensions (6 columns)
            service_code: {
              data_type: 'varchar',
              description: 'AWS service code',
              meta: { type: 'dim' },
            },
            service_name: {
              data_type: 'varchar',
              description: 'Human-readable service name',
              meta: { type: 'dim' },
            },
            service_category: {
              data_type: 'varchar',
              description: 'Service category (compute, storage, network, etc.)',
              meta: { type: 'dim' },
            },
            service_family: {
              data_type: 'varchar',
              description: 'Service family grouping',
              meta: { type: 'dim' },
            },
            pricing_model: {
              data_type: 'varchar',
              description: 'Pricing model (on-demand, reserved, spot)',
              meta: { type: 'dim' },
            },
            launch_date: {
              data_type: 'date',
              description: 'Service launch date',
              meta: { type: 'dim' },
            },

            // Facts (4 columns)
            typical_cost_per_hour: {
              data_type: 'string',
              description: 'Typical cost per hour',
              meta: { type: 'fct' },
            },
            resource_efficiency_score: {
              data_type: 'string',
              description: 'Resource efficiency score',
              meta: { type: 'fct' },
            },
            usage_frequency_rank: {
              data_type: 'integer',
              description: 'Usage frequency ranking',
              meta: { type: 'fct' },
            },
            cost_optimization_potential: {
              data_type: 'string',
              description: 'Cost optimization potential percentage',
              meta: { type: 'fct' },
            },
          },
        },

        // === SOURCES (5+ sources) ===
        'source.data_platform.aws_cur.cur_data': {
          name: 'cur_data',
          source_name: 'aws_cur',
          resource_type: 'source',
          columns: {
            // Dimensions (8 columns)
            identity_lineitemid: {
              data_type: 'varchar',
              description: 'Unique identifier for the line item',
              meta: { type: 'dim' },
            },
            bill_billingentity: {
              data_type: 'varchar',
              description: 'AWS billing entity',
              meta: { type: 'dim' },
            },
            bill_billtype: {
              data_type: 'varchar',
              description: 'Type of bill',
              meta: { type: 'dim' },
            },
            bill_payeraccountid: {
              data_type: 'varchar',
              description: 'AWS payer account ID',
              meta: { type: 'dim' },
            },
            lineitem_usageaccountid: {
              data_type: 'varchar',
              description: 'AWS usage account ID',
              meta: { type: 'dim' },
            },
            lineitem_lineitemtype: {
              data_type: 'varchar',
              description: 'Type of line item',
              meta: { type: 'dim' },
            },
            lineitem_usagestartdate: {
              data_type: 'timestamp',
              description: 'Usage start date',
              meta: { type: 'dim' },
            },
            lineitem_productcode: {
              data_type: 'varchar',
              description: 'AWS product code',
              meta: { type: 'dim' },
            },

            // Facts (4 columns)
            lineitem_blendedcost: {
              data_type: 'string',
              description: 'Blended cost amount',
              meta: { type: 'fct' },
            },
            lineitem_unblendedcost: {
              data_type: 'string',
              description: 'Unblended cost amount',
              meta: { type: 'fct' },
            },
            lineitem_usageamount: {
              data_type: 'string',
              description: 'Usage amount',
              meta: { type: 'fct' },
            },
            lineitem_normalizationfactor: {
              data_type: 'string',
              description: 'Normalization factor',
              meta: { type: 'fct' },
            },
          },
        },

        'source.data_platform.gcp_billing.billing_export': {
          name: 'billing_export',
          source_name: 'gcp_billing',
          resource_type: 'source',
          columns: {
            // Dimensions (8 columns)
            billing_account_id: {
              data_type: 'varchar',
              description: 'Unique identifier for GCP billing account',
              meta: { type: 'dim' },
            },
            service_description: {
              data_type: 'varchar',
              description: 'Description of GCP service',
              meta: { type: 'dim' },
            },
            service_id: {
              data_type: 'varchar',
              description: 'GCP service identifier',
              meta: { type: 'dim' },
            },
            sku_id: {
              data_type: 'varchar',
              description: 'GCP SKU identifier',
              meta: { type: 'dim' },
            },
            project_id: {
              data_type: 'varchar',
              description: 'GCP project identifier',
              meta: { type: 'dim' },
            },
            usage_start_time: {
              data_type: 'timestamp',
              description: 'Start time of usage',
              meta: { type: 'dim' },
            },
            usage_end_time: {
              data_type: 'timestamp',
              description: 'End time of usage',
              meta: { type: 'dim' },
            },
            location: {
              data_type: 'varchar',
              description: 'GCP resource location',
              meta: { type: 'dim' },
            },

            // Facts (4 columns)
            cost: {
              data_type: 'string',
              description: 'Cost in billing currency',
              meta: { type: 'fct' },
            },
            currency: {
              data_type: 'varchar',
              description: 'Currency of the cost',
              meta: { type: 'fct' },
            },
            usage_amount: {
              data_type: 'string',
              description: 'Amount of usage',
              meta: { type: 'fct' },
            },
            credits_amount: {
              data_type: 'string',
              description: 'Amount of credits applied',
              meta: { type: 'fct' },
            },
          },
        },

        'source.data_platform.azure_cost.usage_details': {
          name: 'usage_details',
          source_name: 'azure_cost',
          resource_type: 'source',
          columns: {
            // Dimensions (8 columns)
            invoice_id: {
              data_type: 'varchar',
              description: 'Azure invoice identifier',
              meta: { type: 'dim' },
            },
            billing_account_id: {
              data_type: 'varchar',
              description: 'Azure billing account identifier',
              meta: { type: 'dim' },
            },
            subscription_id: {
              data_type: 'varchar',
              description: 'Azure subscription identifier',
              meta: { type: 'dim' },
            },
            resource_group: {
              data_type: 'varchar',
              description: 'Azure resource group name',
              meta: { type: 'dim' },
            },
            resource_id: {
              data_type: 'varchar',
              description: 'Azure resource identifier',
              meta: { type: 'dim' },
            },
            service_name: {
              data_type: 'varchar',
              description: 'Azure service name',
              meta: { type: 'dim' },
            },
            usage_date: {
              data_type: 'date',
              description: 'Date of the usage',
              meta: { type: 'dim' },
            },
            meter_category: {
              data_type: 'varchar',
              description: 'Azure meter category',
              meta: { type: 'dim' },
            },

            // Facts (4 columns)
            cost_in_billing_currency: {
              data_type: 'string',
              description: 'Cost in billing currency',
              meta: { type: 'fct' },
            },
            quantity: {
              data_type: 'string',
              description: 'Quantity of usage',
              meta: { type: 'fct' },
            },
            effective_price: {
              data_type: 'string',
              description: 'Effective price per unit',
              meta: { type: 'fct' },
            },
            discount_amount: {
              data_type: 'string',
              description: 'Discount amount applied',
              meta: { type: 'fct' },
            },
          },
        },

        'source.data_platform.k8s_monitoring.cluster_metrics': {
          name: 'cluster_metrics',
          source_name: 'k8s_monitoring',
          resource_type: 'source',
          columns: {
            // Dimensions (8 columns)
            cluster_id: {
              data_type: 'varchar',
              description: 'Unique identifier for Kubernetes cluster',
              meta: { type: 'dim' },
            },
            node_name: {
              data_type: 'varchar',
              description: 'Kubernetes node name',
              meta: { type: 'dim' },
            },
            namespace: {
              data_type: 'varchar',
              description: 'Kubernetes namespace',
              meta: { type: 'dim' },
            },
            pod_name: {
              data_type: 'varchar',
              description: 'Kubernetes pod name',
              meta: { type: 'dim' },
            },
            container_name: {
              data_type: 'varchar',
              description: 'Container name within pod',
              meta: { type: 'dim' },
            },
            timestamp: {
              data_type: 'timestamp',
              description: 'Timestamp of metric collection',
              meta: { type: 'dim' },
            },
            region: {
              data_type: 'varchar',
              description: 'Geographical region of the cluster',
              meta: { type: 'dim' },
            },
            environment: {
              data_type: 'varchar',
              description: 'Environment (prod, staging, dev)',
              meta: { type: 'dim' },
            },

            // Facts (4 columns)
            cpu_usage_cores: {
              data_type: 'string',
              description: 'CPU usage in cores',
              meta: { type: 'fct' },
            },
            memory_usage_bytes: {
              data_type: 'bigint',
              description: 'Memory usage in bytes',
              meta: { type: 'fct' },
            },
            network_rx_bytes: {
              data_type: 'bigint',
              description: 'Network received bytes',
              meta: { type: 'fct' },
            },
            network_tx_bytes: {
              data_type: 'bigint',
              description: 'Network transmitted bytes',
              meta: { type: 'fct' },
            },
          },
        },

        'source.data_platform.prometheus.time_series_metrics': {
          name: 'time_series_metrics',
          source_name: 'prometheus',
          resource_type: 'source',
          columns: {
            // Dimensions (8 columns)
            metric_name: {
              data_type: 'varchar',
              description: 'Name of the Prometheus metric',
              meta: { type: 'dim' },
            },
            job: {
              data_type: 'varchar',
              description: 'Prometheus job label',
              meta: { type: 'dim' },
            },
            instance: {
              data_type: 'varchar',
              description: 'Instance identifier',
              meta: { type: 'dim' },
            },
            application: {
              data_type: 'varchar',
              description: 'Application name',
              meta: { type: 'dim' },
            },
            service: {
              data_type: 'varchar',
              description: 'Service name',
              meta: { type: 'dim' },
            },
            environment: {
              data_type: 'varchar',
              description: 'Environment label',
              meta: { type: 'dim' },
            },
            timestamp: {
              data_type: 'timestamp',
              description: 'Time of metric collection',
              meta: { type: 'dim' },
            },
            cluster: {
              data_type: 'varchar',
              description: 'Cluster identifier',
              meta: { type: 'dim' },
            },

            // Facts (4 columns)
            value: {
              data_type: 'string',
              description: 'Metric value',
              meta: { type: 'fct' },
            },
            rate_1m: {
              data_type: 'string',
              description: '1-minute rate of change',
              meta: { type: 'fct' },
            },
            rate_5m: {
              data_type: 'string',
              description: '5-minute rate of change',
              meta: { type: 'fct' },
            },
            quantile_95: {
              data_type: 'string',
              description: '95th percentile value',
              meta: { type: 'fct' },
            },
          },
        },

        'source.data_platform.mlflow.model_registry': {
          name: 'model_registry',
          source_name: 'mlflow',
          resource_type: 'source',
          columns: {
            // Dimensions (8 columns)
            model_name: {
              data_type: 'varchar',
              description: 'Name of the registered model',
              meta: { type: 'dim' },
            },
            version: {
              data_type: 'varchar',
              description: 'Model version identifier',
              meta: { type: 'dim' },
            },
            run_id: {
              data_type: 'varchar',
              description: 'MLflow run identifier',
              meta: { type: 'dim' },
            },
            status: {
              data_type: 'varchar',
              description: 'Current status of the model version',
              meta: { type: 'dim' },
            },
            user_id: {
              data_type: 'varchar',
              description: 'User who created the model version',
              meta: { type: 'dim' },
            },
            created_at: {
              data_type: 'timestamp',
              description: 'Creation timestamp',
              meta: { type: 'dim' },
            },
            last_updated_at: {
              data_type: 'timestamp',
              description: 'Last update timestamp',
              meta: { type: 'dim' },
            },
            stage: {
              data_type: 'varchar',
              description: 'Deployment stage of model',
              meta: { type: 'dim' },
            },

            // Facts (4 columns)
            accuracy: {
              data_type: 'string',
              description: 'Model accuracy metric',
              meta: { type: 'fct' },
            },
            f1_score: {
              data_type: 'string',
              description: 'Model F1 score metric',
              meta: { type: 'fct' },
            },
            training_duration_seconds: {
              data_type: 'bigint',
              description: 'Training duration in seconds',
              meta: { type: 'fct' },
            },
            inference_time_ms: {
              data_type: 'string',
              description: 'Average inference time in milliseconds',
              meta: { type: 'fct' },
            },
          },
        },
      },
      sources: {
        'source.data_platform.aws_cur.cur_data': {
          name: 'cur_data',
          source_name: 'aws_cur',
          resource_type: 'source',
          columns: {
            // Dimensions (8 columns)
            identity_lineitemid: {
              data_type: 'varchar',
              description: 'Unique identifier for the line item',
              meta: { type: 'dim' },
            },
            bill_billingentity: {
              data_type: 'varchar',
              description: 'AWS billing entity',
              meta: { type: 'dim' },
            },
            bill_billtype: {
              data_type: 'varchar',
              description: 'Type of bill',
              meta: { type: 'dim' },
            },
            bill_payeraccountid: {
              data_type: 'varchar',
              description: 'AWS payer account ID',
              meta: { type: 'dim' },
            },
            lineitem_usageaccountid: {
              data_type: 'varchar',
              description: 'AWS usage account ID',
              meta: { type: 'dim' },
            },
            lineitem_lineitemtype: {
              data_type: 'varchar',
              description: 'Type of line item',
              meta: { type: 'dim' },
            },
            lineitem_usagestartdate: {
              data_type: 'timestamp',
              description: 'Usage start date',
              meta: { type: 'dim' },
            },
            lineitem_productcode: {
              data_type: 'varchar',
              description: 'AWS product code',
              meta: { type: 'dim' },
            },

            // Facts (4 columns)
            lineitem_blendedcost: {
              data_type: 'string',
              description: 'Blended cost amount',
              meta: { type: 'fct' },
            },
            lineitem_unblendedcost: {
              data_type: 'string',
              description: 'Unblended cost amount',
              meta: { type: 'fct' },
            },
            lineitem_usageamount: {
              data_type: 'string',
              description: 'Usage amount',
              meta: { type: 'fct' },
            },
            lineitem_normalizationfactor: {
              data_type: 'string',
              description: 'Normalization factor',
              meta: { type: 'fct' },
            },
          },
        },

        'source.data_platform.gcp_billing.billing_export': {
          name: 'billing_export',
          source_name: 'gcp_billing',
          resource_type: 'source',
          columns: {
            // Dimensions (8 columns)
            billing_account_id: {
              data_type: 'varchar',
              description: 'Unique identifier for GCP billing account',
              meta: { type: 'dim' },
            },
            service_description: {
              data_type: 'varchar',
              description: 'Description of GCP service',
              meta: { type: 'dim' },
            },
            service_id: {
              data_type: 'varchar',
              description: 'GCP service identifier',
              meta: { type: 'dim' },
            },
            sku_id: {
              data_type: 'varchar',
              description: 'GCP SKU identifier',
              meta: { type: 'dim' },
            },
            project_id: {
              data_type: 'varchar',
              description: 'GCP project identifier',
              meta: { type: 'dim' },
            },
            usage_start_time: {
              data_type: 'timestamp',
              description: 'Start time of usage',
              meta: { type: 'dim' },
            },
            usage_end_time: {
              data_type: 'timestamp',
              description: 'End time of usage',
              meta: { type: 'dim' },
            },
            location: {
              data_type: 'varchar',
              description: 'GCP resource location',
              meta: { type: 'dim' },
            },

            // Facts (4 columns)
            cost: {
              data_type: 'string',
              description: 'Cost in billing currency',
              meta: { type: 'fct' },
            },
            currency: {
              data_type: 'varchar',
              description: 'Currency of the cost',
              meta: { type: 'fct' },
            },
            usage_amount: {
              data_type: 'string',
              description: 'Amount of usage',
              meta: { type: 'fct' },
            },
            credits_amount: {
              data_type: 'string',
              description: 'Amount of credits applied',
              meta: { type: 'fct' },
            },
          },
        },

        'source.data_platform.azure_cost.usage_details': {
          name: 'usage_details',
          source_name: 'azure_cost',
          resource_type: 'source',
          columns: {
            // Dimensions (8 columns)
            invoice_id: {
              data_type: 'varchar',
              description: 'Azure invoice identifier',
              meta: { type: 'dim' },
            },
            billing_account_id: {
              data_type: 'varchar',
              description: 'Azure billing account identifier',
              meta: { type: 'dim' },
            },
            subscription_id: {
              data_type: 'varchar',
              description: 'Azure subscription identifier',
              meta: { type: 'dim' },
            },
            resource_group: {
              data_type: 'varchar',
              description: 'Azure resource group name',
              meta: { type: 'dim' },
            },
            resource_id: {
              data_type: 'varchar',
              description: 'Azure resource identifier',
              meta: { type: 'dim' },
            },
            service_name: {
              data_type: 'varchar',
              description: 'Azure service name',
              meta: { type: 'dim' },
            },
            usage_date: {
              data_type: 'date',
              description: 'Date of the usage',
              meta: { type: 'dim' },
            },
            meter_category: {
              data_type: 'varchar',
              description: 'Azure meter category',
              meta: { type: 'dim' },
            },

            // Facts (4 columns)
            cost_in_billing_currency: {
              data_type: 'string',
              description: 'Cost in billing currency',
              meta: { type: 'fct' },
            },
            quantity: {
              data_type: 'string',
              description: 'Quantity of usage',
              meta: { type: 'fct' },
            },
            effective_price: {
              data_type: 'string',
              description: 'Effective price per unit',
              meta: { type: 'fct' },
            },
            discount_amount: {
              data_type: 'string',
              description: 'Discount amount applied',
              meta: { type: 'fct' },
            },
          },
        },

        'source.data_platform.k8s_monitoring.cluster_metrics': {
          name: 'cluster_metrics',
          source_name: 'k8s_monitoring',
          resource_type: 'source',
          columns: {
            // Dimensions (8 columns)
            cluster_id: {
              data_type: 'varchar',
              description: 'Unique identifier for Kubernetes cluster',
              meta: { type: 'dim' },
            },
            node_name: {
              data_type: 'varchar',
              description: 'Kubernetes node name',
              meta: { type: 'dim' },
            },
            namespace: {
              data_type: 'varchar',
              description: 'Kubernetes namespace',
              meta: { type: 'dim' },
            },
            pod_name: {
              data_type: 'varchar',
              description: 'Kubernetes pod name',
              meta: { type: 'dim' },
            },
            container_name: {
              data_type: 'varchar',
              description: 'Container name within pod',
              meta: { type: 'dim' },
            },
            timestamp: {
              data_type: 'timestamp',
              description: 'Timestamp of metric collection',
              meta: { type: 'dim' },
            },
            region: {
              data_type: 'varchar',
              description: 'Geographical region of the cluster',
              meta: { type: 'dim' },
            },
            environment: {
              data_type: 'varchar',
              description: 'Environment (prod, staging, dev)',
              meta: { type: 'dim' },
            },

            // Facts (4 columns)
            cpu_usage_cores: {
              data_type: 'string',
              description: 'CPU usage in cores',
              meta: { type: 'fct' },
            },
            memory_usage_bytes: {
              data_type: 'bigint',
              description: 'Memory usage in bytes',
              meta: { type: 'fct' },
            },
            network_rx_bytes: {
              data_type: 'bigint',
              description: 'Network received bytes',
              meta: { type: 'fct' },
            },
            network_tx_bytes: {
              data_type: 'bigint',
              description: 'Network transmitted bytes',
              meta: { type: 'fct' },
            },
          },
        },

        'source.data_platform.prometheus.time_series_metrics': {
          name: 'time_series_metrics',
          source_name: 'prometheus',
          resource_type: 'source',
          columns: {
            // Dimensions (8 columns)
            metric_name: {
              data_type: 'varchar',
              description: 'Name of the Prometheus metric',
              meta: { type: 'dim' },
            },
            job: {
              data_type: 'varchar',
              description: 'Prometheus job label',
              meta: { type: 'dim' },
            },
            instance: {
              data_type: 'varchar',
              description: 'Instance identifier',
              meta: { type: 'dim' },
            },
            application: {
              data_type: 'varchar',
              description: 'Application name',
              meta: { type: 'dim' },
            },
            service: {
              data_type: 'varchar',
              description: 'Service name',
              meta: { type: 'dim' },
            },
            environment: {
              data_type: 'varchar',
              description: 'Environment label',
              meta: { type: 'dim' },
            },
            timestamp: {
              data_type: 'timestamp',
              description: 'Time of metric collection',
              meta: { type: 'dim' },
            },
            cluster: {
              data_type: 'varchar',
              description: 'Cluster identifier',
              meta: { type: 'dim' },
            },

            // Facts (4 columns)
            value: {
              data_type: 'string',
              description: 'Metric value',
              meta: { type: 'fct' },
            },
            rate_1m: {
              data_type: 'string',
              description: '1-minute rate of change',
              meta: { type: 'fct' },
            },
            rate_5m: {
              data_type: 'string',
              description: '5-minute rate of change',
              meta: { type: 'fct' },
            },
            quantile_95: {
              data_type: 'string',
              description: '95th percentile value',
              meta: { type: 'fct' },
            },
          },
        },

        'source.data_platform.mlflow.model_registry': {
          name: 'model_registry',
          source_name: 'mlflow',
          resource_type: 'source',
          columns: {
            // Dimensions (8 columns)
            model_name: {
              data_type: 'varchar',
              description: 'Name of the registered model',
              meta: { type: 'dim' },
            },
            version: {
              data_type: 'varchar',
              description: 'Model version identifier',
              meta: { type: 'dim' },
            },
            run_id: {
              data_type: 'varchar',
              description: 'MLflow run identifier',
              meta: { type: 'dim' },
            },
            status: {
              data_type: 'varchar',
              description: 'Current status of the model version',
              meta: { type: 'dim' },
            },
            user_id: {
              data_type: 'varchar',
              description: 'User who created the model version',
              meta: { type: 'dim' },
            },
            created_at: {
              data_type: 'timestamp',
              description: 'Creation timestamp',
              meta: { type: 'dim' },
            },
            last_updated_at: {
              data_type: 'timestamp',
              description: 'Last update timestamp',
              meta: { type: 'dim' },
            },
            stage: {
              data_type: 'varchar',
              description: 'Deployment stage of model',
              meta: { type: 'dim' },
            },

            // Facts (4 columns)
            accuracy: {
              data_type: 'string',
              description: 'Model accuracy metric',
              meta: { type: 'fct' },
            },
            f1_score: {
              data_type: 'string',
              description: 'Model F1 score metric',
              meta: { type: 'fct' },
            },
            training_duration_seconds: {
              data_type: 'bigint',
              description: 'Training duration in seconds',
              meta: { type: 'fct' },
            },
            inference_time_ms: {
              data_type: 'string',
              description: 'Average inference time in milliseconds',
              meta: { type: 'fct' },
            },
          },
        },
      },
      groups: [
        { name: 'analytics' },
        { name: 'sales' },
        { name: 'marketing' },
        { name: 'demo' },
        { name: 'finance' },
        { name: 'data-platform' },
      ],
    },
  }) as unknown as DbtProject;

/**
 * Alternative mock projects for different scenarios
 */
export const createAnalyticsProject = (): DbtProject =>
  ({
    name: 'mock_analytics_project',
    manifest: {
      nodes: {
        'model.analytics.user_sessions': {
          name: 'user_sessions',
          columns: {
            session_id: {
              data_type: 'varchar',
              description: 'Unique identifier for each user session',
              meta: { type: 'dim' },
            },
            user_id: {
              data_type: 'varchar',
              description: 'User identifier',
              meta: { type: 'dim' },
            },
            session_start: {
              data_type: 'timestamp',
              description: 'When the session started',
              meta: { type: 'dim' },
            },
            page_views: {
              data_type: 'integer',
              description: 'Number of pages viewed in session',
              meta: { type: 'fct' },
            },
            session_duration: {
              data_type: 'integer',
              description: 'Duration of session in seconds',
              meta: { type: 'fct' },
            },
          },
        },
        'model.analytics.events': {
          name: 'events',
          columns: {
            event_id: {
              data_type: 'varchar',
              description: 'Unique identifier for each event',
              meta: { type: 'dim' },
            },
            event_type: {
              data_type: 'varchar',
              description: 'Type of event (click, view, purchase, etc.)',
              meta: { type: 'dim' },
            },
            timestamp: {
              data_type: 'timestamp',
              description: 'When the event occurred',
              meta: { type: 'dim' },
            },
            event_count: {
              data_type: 'integer',
              description: 'Count of events',
              meta: { type: 'fct' },
            },
          },
        },
      },
    },
  }) as unknown as DbtProject;
