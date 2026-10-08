// O payload de exemplo da Shopify para checkouts/create (Admin API 2024-10),
// recortado no que importa: dado pessoal em todo canto e os itens no meio.
export const CHECKOUT_DE_EXEMPLO = {
  id: 981820079,
  token: "123123123",
  cart_token: "eeafa272cebfd4b22385bc4b645e762c",
  email: "example@email.com",
  phone: null,
  customer_locale: "en",
  note_attributes: [{ name: "custom engraving", value: "Happy Birthday" }],
  line_items: [
    {
      key: "a9a2c8d5",
      sku: "IPOD2008PINK",
      variant_id: 808950810,
      product_id: 632910392,
      title: "IPod Nano - 8GB",
      quantity: 1,
      price: "199.00",
    },
    { key: "b1", sku: "", variant_id: 49148385, title: "Sem SKU", quantity: 2 },
    { key: "c1", sku: null, variant_id: null, title: "Nada", quantity: 1 },
  ],
  billing_address: { first_name: "Bob", address1: "123 Billing Street", phone: "555-555-BILL", city: "Billtown" },
  shipping_address: { first_name: "Steve", address1: "123 Shipping Street", phone: "555-555-SHIP" },
  customer: {
    id: 603851970,
    email: "john@doe.ca",
    first_name: "John",
    last_name: "Smith",
    default_address: { phone: "123-123-1234", address1: "123 Elm St." },
  },
};

/** O que nao pode aparecer em nada que o sensor grava. */
export const DADOS_DO_COMPRADOR = [
  "example@email.com",
  "john@doe.ca",
  "555-555",
  "123-123",
  "Street",
  "Elm St",
  "Bob",
  "Steve",
  "Smith",
  "Birthday",
];
