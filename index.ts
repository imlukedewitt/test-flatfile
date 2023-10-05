import api from "@flatfile/api";
import { FlatfileEvent, FlatfileListener } from "@flatfile/listener";
import { automap } from "@flatfile/plugin-automap";
import { FlatfileRecord, recordHook } from "@flatfile/plugin-record-hook";
// import { ExcelExtractor } from "@flatfile/plugin-xlsx-extractor";
import nodemailer from "nodemailer";
import { promisify } from "util";
import { JSONExtractor } from "@flatfile/plugin-json-extractor";
import { dedupePlugin } from "@flatfile/plugin-dedupe";


// ///// LUKE'S NOTES /////
// Like we discussed, I'm adding comments for a typical customer import.
// This includes 1 customer and optionally 1 payment profile. Standalone
// customers need to be imported before customers that have a parent.
// 
// We'll need to make sure we can handle all the special characters
// you might run into when working with international customers
// 
// The Google Sheets Importer would start by creating a new Workbook
// every time it's launched. In the future I'd add logic to check for
// existing Workbooks for the project.
//
// My first idea for monitoring/reporting is that Sheets would call 
// Flatfile's API every N seconds, checking for updates. Once the import's
// complete, Sheets would pull a results/summary from Flatfile. This way,
// Flatfile doesn't need to auth with Sheets. Happy to be advised here :D 
//
// Create customer: https://developers.chargify.com/docs/api-docs/18237bcfe5cbb-create-customer
// Create card: https://developers.chargify.com/docs/api-docs/1f10a4f170405-create-payment-profile
// Link to our (old) template for Customers/Cards: https://docs.google.com/spreadsheets/d/15_YevImWH8aBFFRhlGHxOe-qE07p1qLZxEtv4-reETs/edit#gid=494367529
//
// /////////////////////

export default function flatfileEventListener(listener: FlatfileListener) {
  // 1.Create a Workbook
  listener.on("space:created", async (event: FlatfileEvent) => {
    const { spaceId, environmentId } = event.context; // (?) Can I add more variables to this event context?

    // Date included in workbook name
    const date = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    // Add secrets when space created
    // api.secrets.upsert()

    const workbook = await api.workbooks.create({
      spaceId,
      environmentId,
      name: `${date} Customers`,
      sheets: [
        {
          name: `Customers`,
          slug: "customers",
          fields: [
            // first_name, last_name, email, reference, organization, cc_emails, phone, parent_id, address, address_2, city, state, zip, country, tax_exempt, verified, locale, vat_number, metafields
            // customer_id, payment_type, current_vault, gateway_handle, vault_token, customer_vault_token, first_name, last_name, last_four, card_type, expiration_year, expiration_month, bank_name,
            // bank_account_number, bank_routing_number, billing_address, billing_address_2, billing_city, billing_state, billing_country, billing_zip, paypal_email
            {
              key: "customerID",
              type: "string",
              label: "Customer ID",
              constraints: [{type: 'required'}, {type:'unique'}] 
            },
            {
              key: "parentCustomerID",
              type: "reference",
              label: "Parent Customer",
              config: {
                ref: 'customers',
                key: 'customerId',
                relationship: 'has-one',
              },
            },
            {
              key: "firstName",
              type: "string",
              label: "First Name",
            },
            {
              key: "lastName",
              type: "string",
              label: "Last Name",
            },
            {
              key: "email",
              type: "string",
              label: "Email",
            },
            {
              key: "verified",
              type: "boolean",
              label: "Verified",
            },
          ],
          actions: [
            {
              operation: "dedupe-customers",
              mode: "background",
              label: "Dedupe customer records",
              description: "Remove duplicate customers"
            }
          ]
        },
        {
          name: "Payment Profiles",
          slug: "profiles",
          fields: [
            {
              key: "customerId",
              type: "reference",
              label: "Customer",
              config: {
                ref: 'customers',
                key: 'customerId',
                relationship: 'has-one',
              },
            },
          ]
        }
      ],
    });

    // pre-load existing customers into Flatfile when the space is created
    // get all customers
    // load all customers into workbook that was created
    // const data = await "your API request here"
    // await api.workbooks.get(workbook.data.id);
    // await api.records.insert(sheetId, data)

  });

  // 2. Automate Extraction and Mapping
  
  // This is not a part of our current process so I'll be curious to see what is possible here
  // Typically our customers do the mapping work themselves, with lots of instruction from our ICs
  //
  // Just listing a few common mapping challenges I can think of:
  //   - Name is sometimes a provided as a single text field, sometimes it's 2 fields for first/last name.
  //   - Billing Address lives on the Payment Profile object, not the customer object. Because of this
  //     it's not always clear which Address fields to use for mapping
  //   - The payment profile token mappings will vary quite a bit depending on which payment gateway we're using.
  //     Usually these values have to come from separate files/exports
  //   - Card Expiration might be in a single field, same as first/last name

  // listener.use(ExcelExtractor({ rawNumbers: true }))

  // Adding dedupe plugin and action for customers
  listener.use(
    dedupePlugin("dedupe-customers", {
      on: "customerId",
      keep: "last",
    })
  );

  listener.use(JSONExtractor());
  listener.use(
    automap({
      accuracy: "confident",
      defaultTargetSheet: "Customers",
      matchFilename: /^.*inventory\.xlsx$/,
      onFailure: console.error,
    })
  );

  // 3. Transform and Validate
  listener.use(
    recordHook(
      "customers",
      async (record: FlatfileRecord, event: FlatfileEvent) => {
        // //// TRANSFORMATIONS ////
        // (optional) Fill missing name fields using info from email/org/firstName
        // (optional) Use bogus email address
        // (optional) Use bogus card settings
        // (optional) Replace expired card dates with a valid date
        // If customer has a parent, API call to convert Parent Customer Reference > ID
        // Uppercase/Lowercase misc fields
        // Add leading zeros to last_4 fields less than 4 digits
        // Convert State/Country to ISO 3166-2 format https://en.wikipedia.org/wiki/ISO_3166-2
        // Convert metadata columns to nested JSON using regex filter

        // //// VALIDATIONS ////
        // Skip rows that are already successfully completed
        // Ensure first/last name and email
        // Ensure last_4 fields are numbers
        // If customer has a parent, ensure parent reference or parent ID
        // Validate card token formats based on gateway (regex)
        // (optional) Validate VAT

        const author = record.get("author");
        function validateNameFormat(name) {
          const pattern: RegExp = /^\s*[\p{L}'-]+\s*,\s*[\p{L}'-]+\s*$/u;
          return pattern.test(name);
        }

        if (!validateNameFormat(author)) {
          const nameSplit = (author as string).split(" ");
          record.set("author", `${nameSplit[1]}, ${nameSplit[0]}`);
          record.addComment("author", "Author name was updated for vendor");
          return record;
        }
      }
    )
  );

  // 4. Automate Egress
  listener.on(
    "job:completed",
    { job: "workbook:map" },
    async (event: FlatfileEvent) => {
      // store statuses/payloads/responses in an array to be printed to the Google Sheet
      // store errors/explanations/resolutions in an array to be shown to the user in Sheets
      // email results to user(s)

      // Fetch the email and password from the secrets store
      const email = await event.secrets("email");
      const password = await event.secrets("password");

      const { data } = await api.workbooks.get(event.context.workbookId);
      const inventorySheet = data.sheets[0].id;
      const orderSheet = data.sheets[1].id;

      // Update a purchase order sheet
      const currentInventory = await api.records.get(inventorySheet);
      const purchaseInventory = currentInventory.data.records.map((item) => {
        const stockValue = item.values.stock.value;
        const stockOrder = Math.max(3 - (stockValue as number), 0);
        item.values.purchase = {
          value: stockOrder,
          valid: true,
        };
        const { stock, ...fields } = item.values;
        return fields;
      });
      const purchaseOrder = purchaseInventory.filter(
        (item) => (item.purchase.value as number) > 0
      );

      await api.records.insert(orderSheet, purchaseOrder);

      // Get the purchase order as a CSV
      const csv = await api.sheets.getRecordsAsCsv(orderSheet);

      // Send the purchase order to the warehouse
      const transporter = nodemailer.createTransport({
        service: "Gmail",
        auth: {
          user: email,
          pass: password,
        },
      });
      const mailOptions = {
        from: email,
        to: "warehouse@books.com", // Configure for desired recipient
        subject: "Purchase Order",
        text: "Attached",
        attachments: [
          {
            filename: "orders.csv",
            content: csv,
          },
        ],
      };
      const sendMail = promisify(transporter.sendMail.bind(transporter));
      await sendMail(mailOptions);
    }
  );
}
