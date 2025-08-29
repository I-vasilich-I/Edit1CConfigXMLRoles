import { xml2js, js2xml } from 'xml-js';
import { readFileSync, writeFileSync } from 'fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
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
  return isTargetObject(properties, processedCatalogs, 'Catalog');
}

function isDocument(properties, processedDocuments) {
  return isTargetObject(properties, processedDocuments, 'Document');
}

function isTargetObject(properties, processedObjects, objectName) {
 
  const props = properties.filter(el => el.name === 'name' && el.hasOwnProperty('elements') && el.elements.length > 0);

  if (props.length) {
    const propElements = props[0].elements;

    const a = propElements
      .filter(el => el.hasOwnProperty('text') && String(el.text).startsWith(`${objectName}.`));

    if (a.length > 0) {
      const arr = String(a[0].text).split('.');

      // 1. Document.Invoice.StandardAttribute.Description
      // 2. Document.Invoice
      // we want to add only 2 into processed objects, also only 2 qualifies as the target object 
      if (arr.length === 2) {
        processedObjects.add(arr[1]);
        return true;
      }
    }
  }

  return false;
 
}

function newRightElement(rightName) {
  const rightElement = { 
    type: 'element', 
    name: 'right',  
    elements: [
      { type: 'element',
        name: 'name', 
        elements: [ 
          { 
          type: 'text', 
          text: rightName
          },
        ],
      },
      { type: 'element', 
        name: 'value', 
        elements: [ 
          { type: 'text', 
            text: 'false' 
          }, 
        ],
      },
    ] 
  }

  return rightElement;
}

function newObjectElement(rootObjectName, objectName, rightElements = []) {
  const objectElement = {
    type: 'element', 
    name: 'object', 
    elements: [
      { 
        type: 'element', 
        name: 'name', 
        elements: [
          { type: 'text', 
            text: `${rootObjectName}.${objectName}`,
          },
        ],
      },
        ...rightElements,
    ]
  }


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
    const rightPropsValue = rightProps.find(k => k.hasOwnProperty('name') && k.name === 'value');

    if (rightPropsName.hasOwnProperty('elements') && rightPropsName.elements.length && setOfProperties.has(rightPropsName.elements[0].text)) {
      if (rightPropsValue.hasOwnProperty('elements') && rightPropsValue.elements.length) {
        rightPropsValue.elements[0].text = 'false';
        processedProps.add(rightPropsName.elements[0].text);
      }
    } 
  });

  setOfProperties.keys().forEach((key) => {
    if (!processedProps.has(key)) {
      properties.push(newRightElement(key));
    }
  });

}

function addUnprocessedObjects(objectElements, listOfObjects, processedObjects, setOfProperties, rootObjectName) {
  listOfObjects.forEach((objectName) => {
    if (!processedObjects.has(objectName)) {
      const rightElements = [];

      setOfProperties.keys().forEach((key) => {
        rightElements.push(newRightElement(key));
      });

      objectElements.push(newObjectElement(rootObjectName, objectName, rightElements));
    }
  });  
}

async function processFile(filePath, documents, catalogs) {
  const xml = await readFile(filePath, 'utf8');

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

  await writeFile(filePath, xmlres);
}

function getDirPath() {
  const args = process.argv.slice(2);

  return args[0]?.split('=')[1] || undefined;
};


async function getListOfObjects(dirPath, folderName) {

  const documentsDirPath = path.join(dirPath, `${folderName}\\`);

  try {
    const documentFiles = await readdir(documentsDirPath);

    const documents = documentFiles
      .filter((docFile) => path.extname(docFile) === '.xml')
      .map((docFile) => path.basename(docFile, '.xml'));

    return documents;
    
  } catch (error) {
    console.error(err);
  }

  return [];    
}

async function getListOfRoleFiles(dirPath) {
  try {
    const files = await readdir(dirPath, { recursive: true }); 

    return files;
  } catch (error) {
    console.error(err);
  }

  return [];
}

async function processConfigFiles(dirPath) {
  try {
    const rolesDirPath = path.join(dirPath, 'Roles\\');

    const documents = await getListOfObjects(dirPath, 'Documents');
    const catalogs = await getListOfObjects(dirPath, 'Catalogs'); 
    const rolefiles = await getListOfRoleFiles(rolesDirPath);

    for (const file of rolefiles) {
      if (path.basename(file) === 'Rights.xml') {
        const filePath = path.join(rolesDirPath, path.dirname(file), path.basename(file));
        await processFile(filePath, documents, catalogs); 
      }
    }
  } catch (err) {
    console.error(err);
  } 
}

processConfigFiles(getDirPath());

