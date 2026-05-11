import xlsx from 'xlsx';

const workbook = xlsx.readFile('C:\\Users\\Owner\\Downloads\\Rebuilt Title Dealership Accounting 3.xlsx');
for (const sheetName of workbook.SheetNames) {
    console.log(`\n--- Sheet: ${sheetName} ---`);
    const worksheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(worksheet);
    console.log(JSON.stringify(data.slice(0, 50), null, 2));
}
