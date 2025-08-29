import { xml2js, js2xml } from 'xml-js';
import { readFileSync, writeFileSync } from 'fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';


function getDocumentsSetOfProperties(){
  const setOfProperties = new Set;
  setOfProperties.add('InteractiveDelete');
  setOfProperties.add('InteractiveDeleteMarked');

  return setOfProperties;
}

function getCatalogSetOfProperties(){
  const setOfProperties = new Set;
  setOfProperties.add('InteractiveDelete');
  setOfProperties.add('InteractiveDeleteMarked');
  setOfProperties.add('InteractiveDeletePredefinedData');
  setOfProperties.add('InteractiveDeleteMarkedPredefinedData');

  return setOfProperties;
}

function isCatalog(properties, processedCatalogs) {
 
  const props = properties.filter(el => el.name === 'name' && el.hasOwnProperty('elements') && el.elements.length > 0);

  if (props.length) {
      const propElements = props[0].elements;

      const a = propElements
        .filter(el => el.hasOwnProperty('text') && String(el.text).startsWith('Catalog.'));

      if (a.length > 0) {
        processedCatalogs.add(String(a[0].text).split('.')[1]);
      }

      return a.length > 0;
  }

  return false;
 
}

function isDocument(properties, processedDocuments) {
 
  const props = properties.filter(el => el.name === 'name' && el.hasOwnProperty('elements') && el.elements.length > 0);

  if (props.length) {
      const propElements = props[0].elements;

      const a = propElements
        .filter(el => el.hasOwnProperty('text') && String(el.text).startsWith('Document.'));

      if (a.length > 0) {
        processedDocuments.add(String(a[0].text).split('.')[1])
      }

      return a.length > 0;
  }

  return false;
 
}

function editProperties(properties, setOfProperties) {
  const props = properties.filter(el => el.name === 'right' && el.hasOwnProperty('elements') && el.elements.length > 0); 
  
  if (!props.length) {
    return;
  }

  const processedProps = new Set;

  props.forEach((el) => {
    const rightProps = el.elements;
    const rightPropsName = rightProps.find(k => k.hasOwnProperty('name') && k.name === 'name');
    const rightPropsVlue = rightProps.find(k => k.hasOwnProperty('name') && k.name === 'value');

    if (rightPropsName.hasOwnProperty('elements') && rightPropsName.elements.length && setOfProperties.has(rightPropsName.elements[0].text)) {
      if (rightPropsVlue.hasOwnProperty('elements') && rightPropsVlue.elements.length) {
        rightPropsVlue.elements[0].text = 'false';
        processedProps.add(rightPropsName.elements[0].text);
      }
    }
    
  });

  setOfProperties.keys().forEach((key) => {
    if (!processedProps.has(key)) {
      properties.push({ type: 'element', name: 'right',  elements: [
        { type: 'element', name: 'name', elements: [ { type: 'text', text: key} ]},
        { type: 'element', name: 'value', elements: [ { type: 'text', text: 'false' } ]}
      ] });
    }
  });

}

function addUnprocessedObjects(RighstElements, listOfObjects, processedObjects, setOfProperties, objectName) {
  listOfObjects.forEach((doc) => {
    if (!processedObjects.has(doc)) {

      const setOfRights = [];
      setOfProperties.keys().forEach((key) => {
        setOfRights.push({ type: 'element', name: 'right',  elements: [
          { type: 'element', name: 'name', elements: [ { type: 'text', text: key} ]},
          { type: 'element', name: 'value', elements: [ { type: 'text', text: 'false' } ]}
        ]});
      });


      const objectRight = {
        type: 'element', name: 'object', elements: [
          { 
            type: 'element', name: 'name', elements: [
            { type: 'text', text: `${objectName}.${doc}`}
          ]},
          ...setOfRights,
        ]
      }

      RighstElements.push(objectRight);

    }
  })  
}

function processFile(filePath, documents, catalogs) {
  const xml = readFileSync(filePath, 'utf8');

  const result = xml2js(xml, {compact: false, spaces: 2});

  const documentsSetOfProperties = getDocumentsSetOfProperties();
  const catalogsSetOfProperties = getCatalogSetOfProperties();

  const processedDocuments = new Set;
  const processedCatalogs = new Set;


  const Rights = result.elements[0];

  const RighstElements = Rights.elements;
  

  for (let i = 0; i < RighstElements.length; i++) {

    const object = RighstElements[i];

    if (object.name !== 'object') {
      continue;
    }

    const properties = object.elements;

    if (properties.length === 0) {
      continue;
    }

    let setOfProperties = null;

    if (isDocument(properties, processedDocuments)) {
      setOfProperties = documentsSetOfProperties;
    }
    else if (isCatalog(properties, processedCatalogs)) {
      setOfProperties = catalogsSetOfProperties;
    }
    
    if (!setOfProperties) {
      continue;
    }

    editProperties(properties, setOfProperties);
    
    
  }

  const setForAttributesByDefault = RighstElements.find(el => el.name === 'setForAttributesByDefault');
  
  const isSetForAttributesByDefault = setForAttributesByDefault ? setForAttributesByDefault?.elements[0]?.text === 'true' : false;

  if (isSetForAttributesByDefault) {
    addUnprocessedObjects(RighstElements, documents, processedDocuments, documentsSetOfProperties, 'Document');
    addUnprocessedObjects(RighstElements, catalogs, processedCatalogs, catalogsSetOfProperties, 'Catalog');
  }

  const xmlres = js2xml(result, {compact: false, spaces: 2});

  writeFileSync(filePath, xmlres);
}

function getDirPath() {
  const args = process.argv.slice(2);

  return args[0]?.split('=')[1] || undefined;
};

async function getFilePaths(dirPath) {
  try {
    const rolesDirPath = path.join(dirPath, 'Roles\\');
    const documentsDirPath = path.join(dirPath, 'Documents\\');
    const catalogsDirPath = path.join(dirPath, 'Catalogs\\');

    const documentFiles = await readdir(documentsDirPath);

    const documents = documentFiles
      .filter((docFile) => path.extname(docFile) === '.xml')
      .map((docFile) => path.basename(docFile, '.xml'));

    const catalogFiles = await readdir(catalogsDirPath);

    const catalogs = catalogFiles
      .filter((catFile) => path.extname(catFile) === '.xml')
      .map((catFile) => path.basename(catFile, '.xml'));

    const files = await readdir(rolesDirPath, { recursive: true });
    for (const file of files) {
      if (path.basename(file) === 'Rights.xml') {

        const filePath = path.join(rolesDirPath, path.dirname(file), path.basename(file));
        processFile(filePath, documents, catalogs); 
      }
    }
  } catch (err) {
    console.error(err);
  } 
}

getFilePaths(getDirPath());

