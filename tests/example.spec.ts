import { test, expect, Page, selectors } from '@playwright/test';
import csv from "csv-parser";
import { createObjectCsvWriter } from "csv-writer";
import fs from "fs";

const FILEPATH = "/Users/samuel/Downloads/";
const FILENAME = "Cold Call - Sheet1.csv";
const WRITEFILE = FILEPATH + "out_" + FILENAME;

// npx playwright test -g "get" --headed
test.describe('Get Phone Numbers', () => {
  test("get", async ({page}) => {
    const rows: Array<{
      "Name(s)": string;
      "Address": string;
      "Town": string;
      "Phone Number": string;
    }> = [];
    const p = new Promise((fulfill) => {
      fs.createReadStream(FILEPATH + FILENAME)
      .pipe(csv())
      .on('data', (row) => {
        rows.push(row);
      })
      .on('end', async () => {
        for (const row of rows) {
          console.log("Next row:", row);
          const nameRow = row["Name(s)"].split(" ");
          const firstName = nameRow[0];
          const lastName = nameRow[nameRow.length - 1];
          if (row['Phone Number'].length > 0) {
            continue;
          }
          let phoneNumber = await getPhoneNumber({
            page,
            firstName: firstName,
            lastName: lastName,
            address: row.Address,
            town: row.Town,
            state: "Connecticut",
          });
          if (phoneNumber.length === 0) {
            phoneNumber = await getPhoneNumberClustrMaps({
              page,
              firstName: firstName,
              lastName: lastName,
              address: row.Address,
              town: row.Town,
              state: "Connecticut",
            });
          }
          row['Phone Number'] = phoneNumber;
          console.log("Got phone:", phoneNumber);
        }
        const csvWriter = createObjectCsvWriter({
          path: WRITEFILE,
          header: [
            { id: "Name(s)", title: "Name(s)" },
            { id: "Address", title: "Address" },
            { id: "Town", title: "Town" },
            { id: "Phone Number", title: "Phone Number" }
          ]
        })
        .writeRecords(rows)
        .then(() => {
          console.log("Wrote:", WRITEFILE);
          fulfill(undefined);
        })

      });
    });
    await p;
  });

});

async function getPhoneNumber({
  page, firstName, lastName, address, town, state
}: {
  page: Page, firstName: string, lastName: string, address:string, town: string, state: string
}) {
  await page.goto("https://voterrecords.com/voters/");

  // Click [placeholder="First Name"]
  await page.locator('[placeholder="First Name"]').click();
  // Fill [placeholder="First Name"]
  await page.locator('[placeholder="First Name"]').fill(firstName);
  // Click [placeholder="Last Name"]
  await page.locator('[placeholder="Last Name"]').click();
  // Fill [placeholder="Last Name"]
  await page.locator('[placeholder="Last Name"]').fill(lastName);
  // Select CT
  await page.locator('[aria-label="States"]').selectOption('CT');
  // Click [placeholder="City"]
  await page.locator('[placeholder="City"]').click();
  // Fill [placeholder="City"]
  await page.locator('[placeholder="City"]').fill(town);
  // Press Enter
  await page.locator('[placeholder="City"]').press('Enter');
  // Click text=Ms Jennifer Graham >> nth=0



  if (await selectorExists(page, ".TopH1")) {
    const numVoterRecordsText = await page.locator('.TopH1').first().textContent();
    if (numVoterRecordsText.indexOf("0 Voter Records") >= 0) {
      console.log(numVoterRecordsText);
      return "";
    }
  }

  await page.locator('css = td >> a').first().click();

  const isValid = await validateCorrectLink({ page, firstName, lastName, address, town, state});
  if (isValid) {
    const phoneNumber = await page.locator('span[itemprop="telephone"]').textContent();
    console.log(firstName, lastName, town, phoneNumber);
    return phoneNumber;
  }
  else {
    console.log(firstName, lastName, town, "N/A");
    return "";
  }
}

async function validateCorrectLink({
  page, firstName, lastName, address, town, state
}: {
  page: Page, firstName: string, lastName: string, address:string, town: string, state: string
}): Promise<boolean> {
  if (!(await selectorExists(page, 'span[itemprop="telephone"]'))) {
    console.log("===== Additional permissions needed =====");
    return false;
  }
  const townText = await page.locator('span[itemprop="addressLocality"]').first().textContent();
  const stateText = await page.locator('span[itemprop="addressRegion"]').first().textContent();
  const nameText = await page.locator('span[itemprop="name"]').first().textContent();
  const addressText = await page.locator('.top-address-link').first().textContent();

  if (townText !== town ||
    stateText !== state ||
    nameText.indexOf(firstName) === -1 ||
    nameText.indexOf(lastName) === -1 ||
    addressText.indexOf(address) === -1) {
    console.log("Expected:", firstName, lastName, address, town, state);
    console.log("Got:", nameText, addressText, townText, stateText);
    return false;
  }
  return true;
}


async function selectorExists(page: Page, selector: string): Promise<boolean> {
  try {
    await page.waitForSelector(selector, { timeout: 1000 });
    return true;
  }
  catch {
    return false;
    // Not present - can continue
  }
}

function replaceAddressForClustrMaps(address: string, town: string): string {
  address = address.replace("Drive", "Dr");
  address = address.replace("Street", "St");
  address = address.replace("Road", "Rd");
  address = address.replace("Lane", "Ln");
  address = address.replace("Trail", "Trail");
  address = address.replace("Parkway", "Pkwy");
  address = address.replace("Avenue", "Ave");
  address = address.replace("Unit ", "#");
  address = address.replace("Turnpike", "Turnpike");
  address = address.replace("Court", "Ct");
  return `${address}, ${town}, CT`
}

async function getPhoneNumberClustrMaps({ page, firstName, lastName, address, town, state}: { page: Page, firstName, lastName, address, town, state }): Promise<string> {
  await page.goto("https://clustrmaps.com");

  await page.locator('[placeholder="Address"]').click();
  const addr = replaceAddressForClustrMaps(address, town);
  await page.locator('[placeholder="Address"]').fill(addr);
  await page.locator('[placeholder="Address"]').press('Enter');
  let hasSecurityCheck = await selectorExists(page, ':has-text("Please complete the security check to access")');
  if (hasSecurityCheck) {
     await page.pause();
  }
  const hasName = await selectorExists(page, `span:text("${firstName}"):text("${lastName}")`);
  if (!hasName) {
    console.log("Did not find name");
    return "";
  }
  const phoneSelector = `.card-body:has-text("${firstName}").card-body:has-text("${lastName}") > * span[itemprop="telephone"]`
  const hasPhone = await selectorExists(page, phoneSelector);
  if (!hasPhone) {
    console.log("Has name but not phone");
    return ""
  }
  const phoneNumber = await page.locator(phoneSelector).first().textContent();
  return phoneNumber;
}
