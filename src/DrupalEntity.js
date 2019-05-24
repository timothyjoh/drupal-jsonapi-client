import idx from 'idx'
import MalformedEntity from './Error/MalformedEntity'

if (process.env.BABEL_ENV === 'test') {
  require('regenerator-runtime/runtime') // eslint-disable-line
  require('cross-fetch/polyfill') // eslint-disable-line
}

const TypeHeaders = {
  Accept: 'application/vnd.api+json',
  'Content-Type': 'application/vnd.api+json',
}

export default class DrupalEntity {
  constructor(
    entityType,
    entityBundle,
    entityUuid,
    entityVersionId,
    requiredFieldsSerializationFields,
  ) {
    this.entityType = entityType
    this.entityBundle = entityBundle
    this.entityUuid = entityUuid || null

    this._entityId = null
    this._versionId = entityVersionId || null
    this._requiredFields = requiredFieldsSerializationFields || null
    this._attributes = {}
    this._relationships = {}
    this._changes = {
      attributes: {},
      relationships: {},
    }

    if (this._requiredFields) {
      this._requiredFields.forEach((field) => {
        if (field.field_type !== 'entity_reference') {
          this.editAttribute(field.field_name, '')
        } else {
          this.editRelationship(field.field_name, {
            data: {},
          })
        }
      })
    }
  }

  _applySerializedData(jsonApiSerialization) {
    const [entityType, entityBundle] = jsonApiSerialization.type.split('--')
    this.entityType = entityType
    this.entityBundle = entityBundle
    this.entityUuid = jsonApiSerialization.id
    this._entityId = jsonApiSerialization.attributes.drupal_internal__nid
    this._versionId = jsonApiSerialization.attributes.drupal_internal__vid
    this._attributes = jsonApiSerialization.attributes
    this._relationships = Object
      .keys(jsonApiSerialization.relationships)
      .map(key => ({ data: jsonApiSerialization.relationships[key].data, _$key: key }))
      .reduce((prev, curr) => {
        const key = curr._$key
        const copy = curr
        delete copy._$key
        return ({
          ...prev,
          [key]: copy,
        })
      }, {})
  }

  _serializeChanges() {
    const serialization = {
      data: {
        type: `${this.entityType}--${this.entityBundle}`,
        attributes: this._changes.attributes,
        relationships: this._changes.relationships,
      },
    }

    if (Object.keys(serialization.data.attributes).length === 0) {
      delete serialization.data.attributes
    }

    if (Object.keys(serialization.data.relationships).length === 0) {
      delete serialization.data.relationships
    }

    if (this.entityUuid) {
      serialization.data.id = this.entityUuid
    }

    return serialization
  }

  _serializeChangesForField(fieldName) {
    return { data: this.getChange(fieldName) }
  }

  _serialize() {
    const serialization = {
      data: {
        type: `${this.entityType}--${this.entityBundle}`,
        attributes: this._attributes,
        relationships: this._relationships,
      },
    }

    if (Object.keys(serialization.data.attributes).length === 0) {
      delete serialization.data.attributes
    }

    if (Object.keys(serialization.data.relationships).length === 0) {
      delete serialization.data.relationships
    }

    return serialization
  }

  nodeId() {
    return this._entityId
  }

  versionId() {
    return this._versionId
  }

  get(fieldName) {
    return this._attributes[fieldName] || this._relationships[fieldName]
  }

  getChange(fieldName) {
    return this._changes.attributes[fieldName] || this._changes.relationships[fieldName]
  }

  /**
   * Edit an attribute.
   *
   * @param {string} fieldName - Drupal machine name for the field
   * @param {any} fieldValue - value to send to JSON:API
   */
  editAttribute(fieldName, fieldValue) {
    this._attributes[fieldName] = fieldValue
    this._changes.attributes[fieldName] = fieldValue
  }

  /**
   * Edit a relationship.
   *
   * @param {string} fieldName - Drupal machine name for the field
   * @param {any} fieldValue - value to send to JSON:API
   */
  editRelationship(fieldName, fieldValue) {
    this._relationships[fieldName] = fieldValue
    this._changes.relationships[fieldName] = fieldValue
  }

  /**
   * Get the value of an attribute or relationship.
   *
   * @param {string} fieldName - Drupal machine name for field
   */
  getValue(fieldName) {
    return idx(this._relationships, _ => _[fieldName])
      ? idx(this._relationships, _ => _[fieldName])
      : idx(this._attributes, _ => _[fieldName])
  }

  toJsonApiGetRequest(baseUrl) {
    return new Request(`${baseUrl || ''}/jsonapi/${this.entityType}/${this.entityBundle}?filter[id]=${this.entityUuid}`, {
      headers: TypeHeaders,
    })
  }

  async toUploadFileRequest(baseUrl, fieldName, file) {
    const binary = await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = (event) => {
        resolve(event.target.result);
      };
      fr.readAsArrayBuffer(file);
    })

    return this.toUploadBinaryRequest(baseUrl, fieldName, file.name, binary)
  }

  toUploadBinaryRequest(fieldName, fileName, binary, baseUrl) {
    return new Request(`${baseUrl || ''}/jsonapi/${this.entityType}/${this.entityBundle}/${fieldName}`, {
      method: 'POST',
      headers: {
        ...TypeHeaders,
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `file; filename="${fileName}"`,
      },
      body: binary,
    })
  }

  toPostRequest(baseUrl) {
    return new Request(`${baseUrl || ''}/jsonapi/${this.entityType}/${this.entityBundle}`, {
      method: 'POST',
      headers: { ...TypeHeaders },
      body: JSON.stringify(this._serialize()),
    })
  }

  toPatchRequest(baseUrl) {
    if (!this.entityUuid) {
      throw new MalformedEntity('Entity is missing UUID but was used in a PATCH request.')
    }

    return new Request(`${baseUrl || ''}/jsonapi/${this.entityType}/${this.entityBundle}/${this.entityUuid}`, {
      method: 'PATCH',
      headers: { ...TypeHeaders },
      body: JSON.stringify(this._serializeChanges()),
    })
  }

  toPatchRequestForRelationship(fieldName, baseUrl) {
    if (!this.entityUuid) {
      throw new MalformedEntity('Entity is missing UUID but was used in a PATCH request.')
    }

    return new Request(`${baseUrl || ''}/jsonapi/${this.entityType}/${this.entityBundle}/${this.entityUuid}/relationships/${fieldName}`, {
      method: 'PATCH',
      headers: { ...TypeHeaders },
      body: JSON.stringify(this._serializeChangesForField(fieldName)),
    })
  }

  /**
   * Get required fields for this entity.
   *
   * @param {string} baseUrl
   */
  toFieldConfigRequest(baseUrl) {
    return new Request(`${
      baseUrl || ''
    }/jsonapi/field_config/field_config?filter[entity_type]=${
      this.entityType
    }&filter[bundle]=${
      this.entityBundle
    }`, {
      headers: { ...TypeHeaders },
    })
  }
}

export const DrupalEntityFromResponse = (jsonApiSerialization) => {
  const entity = new DrupalEntity()
  entity._applySerializedData(jsonApiSerialization)
  return entity
}

export const DrupalEntityFromSerializedRequiredFields = (requiredFieldsSerialization) => {
  const entity = new DrupalEntity(
    requiredFieldsSerialization.entity_type,
    requiredFieldsSerialization.entity_bundle,
    null,
    null,
    requiredFieldsSerialization.fields,
  )
  return entity
}
