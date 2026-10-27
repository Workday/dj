import {
  MODEL_FIELD_MAX_LENGTH,
  MODEL_NAME_PATTERN,
  MODEL_TOPIC_GROUP_PATTERN,
  VALIDATION_MESSAGES,
} from './validationPatterns';

// Validation rules for model creation form
export const modelValidationRules = {
  projectName: {
    required: 'Project is required to specify where your model will be created',
  },
  name: {
    required: 'Name is required to identify your model',
    pattern: {
      value: MODEL_NAME_PATTERN,
      message: VALIDATION_MESSAGES.name,
    },
    maxLength: {
      value: MODEL_FIELD_MAX_LENGTH,
      message: VALIDATION_MESSAGES.maxLength('Name'),
    },
  },
  source: {
    required: 'Source is required to determine where your data originates',
  },
  type: {
    required: "Type is required to define your model's structure",
  },
  group: {
    required: 'Group is required to organize your model within the project',
  },
  topic: {
    required: 'Topic is required to categorize your model by its data source',
    pattern: {
      value: MODEL_TOPIC_GROUP_PATTERN,
      message: VALIDATION_MESSAGES.topic,
    },
    maxLength: {
      value: MODEL_FIELD_MAX_LENGTH,
      message: VALIDATION_MESSAGES.maxLength('Topic'),
    },
  },
  materialization: {
    required: false, // Now optional - validation handled conditionally in validateStep
  },
};

export const STEP_VALIDATIONS = {
  0: {
    fields: [
      { name: 'projectName', label: 'Project' },
      { name: 'name', label: 'Name' },
      { name: 'source', label: 'Source' },
      { name: 'type', label: 'Type' },
      { name: 'group', label: 'Group' },
      { name: 'topic', label: 'Topic' },
      { name: 'materialization', label: 'Materialization' },
    ],
  },
  2: {
    fields: [
      {
        name: 'incremental_strategy.type',
        label: 'Incremental Strategy - Type',
      },
      {
        name: 'incremental_strategy.unique_key',
        label: 'Incremental Strategy - Unique Key',
      },
    ],
  },
};
