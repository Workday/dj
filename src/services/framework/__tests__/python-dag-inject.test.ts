import {
  buildInjectedDagSource,
  injectTasksContextManagerStyle,
  injectTasksDecoratorStyle,
} from '@services/framework/utils/python-dag-inject';

describe('python-dag-inject', () => {
  describe('injectTasksContextManagerStyle', () => {
    it('injects register_python_model_tasks into a with DAG(...) file', () => {
      const source = `from airflow import DAG
from airflow.operators.python import PythonOperator
from datetime import datetime

with DAG(
    dag_id="source_etl",
    start_date=datetime(2021, 1, 1),
    schedule="@daily",
) as dag:
    start = PythonOperator(task_id="start", python_callable=lambda: None, dag=dag)
    end = PythonOperator(task_id="end", python_callable=lambda: None, dag=dag)

    start >> end
`;

      const result = injectTasksContextManagerStyle(source);

      expect(result).toContain(
        'entry_tasks, exit_tasks = register_python_model_tasks("source_etl", dag)',
      );
      expect(result).toContain('start >> entry_tasks');
      expect(result).toContain('exit_tasks >> end');
      expect(result).not.toContain('_python_models');
      expect(result).not.toContain('_python_run');
    });
  });

  describe('injectTasksDecoratorStyle', () => {
    it('injects register_python_model_tasks into an @dag file', () => {
      const source = `from airflow.decorators import dag

@dag(dag_id="source_etl", schedule="@daily")
def source_etl():
    _start_etl = start_etl()
    _end_etl = end_etl()

    # Sequence tasks
    _start_etl >> _end_etl
`;

      const result = injectTasksDecoratorStyle(source);

      expect(result).toContain(
        'entry_tasks, exit_tasks = register_python_model_tasks("source_etl")',
      );
      expect(result).toContain('# Sequence tasks');
      // Task defs should appear before the sequence marker
      expect(result.indexOf('register_python_model_tasks')).toBeLessThan(
        result.indexOf('# Sequence tasks'),
      );
    });
  });

  describe('buildInjectedDagSource', () => {
    it('returns null when wiring already exists', () => {
      const source = `from _ext_.etl_helper import register_python_model_tasks
with DAG(dag_id="x") as dag:
    entry_tasks, exit_tasks = register_python_model_tasks("x", dag)
`;
      expect(buildInjectedDagSource(source)).toBeNull();
    });

    it('adds the etl_helper import and detects context-manager style', () => {
      const source = `from airflow import DAG
from datetime import datetime

with DAG(dag_id="my_dag", start_date=datetime(2021, 1, 1)) as dag:
    start >> end
`;
      const built = buildInjectedDagSource(source);
      expect(built).not.toBeNull();
      expect(built!.style).toBe('context-manager');
      expect(built!.next).toContain(
        'from _ext_.etl_helper import register_python_model_tasks',
      );
      expect(built!.next).toContain(
        'entry_tasks, exit_tasks = register_python_model_tasks("my_dag", dag)',
      );
    });
  });
});
