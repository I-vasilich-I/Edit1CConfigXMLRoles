import { xml2js, js2xml } from 'xml-js';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// extracts param (the directory path) from command line e.g. "node index.js --dirPath=d:\\ЦФ_ХМЛ\\ 
// извлекает параметр из выполняемой команды
function getDirPath() {
  const args = process.argv.slice(2);

  return args[0]?.split('=')[1] || undefined;
};

// returns the set of document's props(rights) that should be turned off
// возвращает набор прав которые нужно выключить для документов
function getDocumentsSetOfProperties(){
  const setOfProperties = new Set;
  setOfProperties.add('InteractiveDelete');
  setOfProperties.add('InteractiveDeleteMarked');

  return setOfProperties;
}

// returns the set of catalog's props(rights) that should be turned off
// возвращает набор прав которые нужно выключить для справочников
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
      // function should do only one thing, but I broke the rule here ;)
      // 
      // в обработанные объекты должны попадать именно объекты, а не подчененные реквизиты, 
      // т.к. только у объектов есть права на интерактивное удаление
      if (arr.length === 2) {
        processedObjects.add(arr[1]);
        return true;
      }
    }
  }

  return false;
 
}

// RightElement template
// Шаблон елемента Право
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

// ObjectElement template
// Шаблон елемента Объект
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

  return objectElement;
}

// Go through all rights, if the right is in the set of properties of the target object, 
// then change the value and add to proccessed props set.
// In the end add rights from the set of properties, that ain't proccessed.
// Проверяет права объекта, если право в наборе прав объекта к отключению - редактируем(отключаем)
// и добавляем в набор обработанных прав
// В конце добавляем права из набора, которых нет в обработанных правах.
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

// During 1C Config export into xml-files, not all objects got exported 
// Seams like it fallows that logic, might be wrong:
// - roles with checked checkbox set rights for new objects, export only turned off rights
// - roles with unchecked checkbox set rights for new objects, export only turned on rights
// So after editing all role files, we had to add other objects with the set of properties.
// При выгрузке конфигурации в файлы, выгружает не все объекты
// Похоже логика такая, но это не точно:
// - роли в которых по объекту стоит галочка устанавливать права для новых объектов, выгружает только не проставленные права
// - роли в которых по объекту снята галочка устанавливать права для новых объектов, выгружает только проставленные права
// т.е. по мимо редактирования существующих объектов с правами
// необходимо еще дописывать необработанные объекты с добавлением прав из набора.
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

    if (object?.name !== 'object') {
      continue;
    }

    const properties = object?.elements;

    if (properties?.length === 0) {
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

  addUnprocessedObjects(RighstElements, documents, processedDocuments, documentsSetOfProperties, 'Document');
  addUnprocessedObjects(RighstElements, catalogs, processedCatalogs, catalogsSetOfProperties, 'Catalog');

  const xmlres = js2xml(result, {compact: false, spaces: 2});

  await writeFile(filePath, xmlres);
}

// Documents and Catalogs have each separate folder, with xml files per each object
// File name - Object name
// Документы и Справочники выгружаются каждый в свою папку, в которой лежат xml файлы каждого объекта
// Имя файла - Имя объекта
async function getListOfObjects(dirPath, folderName) {

  const objectsDirPath = path.join(dirPath, `${folderName}\\`);

  try {
    const objectFiles = await readdir(objectsDirPath);

    const objects = objectFiles
      .filter((objFile) => path.extname(objFile) === '.xml')
      .map((objFile) => path.basename(objFile, '.xml'));

    return objects;
    
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
  if (!dirPath) {
    console.log('Dir path is undefined!');
    return;
  }

  try {
    const rolesDirPath = path.join(dirPath, 'Roles\\');

    const documents = await getListOfObjects(dirPath, 'Documents');
    const catalogs = await getListOfObjects(dirPath, 'Catalogs'); 
    const rolefiles = await getListOfRoleFiles(rolesDirPath);

    const promises = [];

    for (const file of rolefiles) {
      if (path.basename(file) === 'Rights.xml') {
        const filePath = path.join(rolesDirPath, path.dirname(file), path.basename(file));
        promises.push(processFile(filePath, documents, catalogs)); 
      }
    }

    await Promise.all(promises);
  } catch (err) {
    console.error(err);
  } 
}

processConfigFiles(getDirPath());

