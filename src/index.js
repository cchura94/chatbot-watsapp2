const {
  DisconnectReason,
  default: makeWASocket,
  useMultiFileAuthState,
} = require("@whiskeysockets/baileys");
const axios = require("axios");

// BD sequelize
const { DataTypes, Sequelize } = require("sequelize");
// conexion
const sequelize = new Sequelize("bd_chatbot_test2", "root", "", {
  host: "localhost",
  dialect: "mysql",
});
// prueba de conexion
async function testConexionBD() {
  try {
    await sequelize.authenticate();
    console.log("CONEXION CORRECTA BD.");
  } catch (error) {
    console.error("ERROR DE CONEXION:", error);
  }
}
testConexionBD();

// creacion de modelos
const Contacto = sequelize.define("Contacto", {
  nombre: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  numero: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  saldo_pendiente: {
    type: DataTypes.DECIMAL,
    allowNull: true,
  },
});

const Mensaje = sequelize.define("Mensaje", {
  mensaje: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  contactoId: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
});

Contacto.hasMany(Mensaje, {
  foreignKey: "contactoId",
  allowNull: false,
});
Mensaje.belongsTo(Contacto, {
  foreignKey: "contactoId",
  allowNull: false,
});

Contacto.sync();
Mensaje.sync();

const userContext = {};

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");
  const sock = makeWASocket({
    // can provide additional config here
    auth: state,
    printQRInTerminal: true,
  });
  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log(
        "connection closed due to ",
        lastDisconnect.error,
        ", reconnecting ",
        shouldReconnect
      );
      // reconnect if not logged out
      if (shouldReconnect) {
        connectToWhatsApp();
      }
    } else if (connection === "open") {
      console.log("opened connection");
    }
  });
  sock.ev.on("messages.upsert", async (event) => {
    const message = event.messages[0];
    if (message.key.fromMe && event.type != "notify") {
      return;
    }

    const id = event.messages[0].key.remoteJid;
    const nombre = event.messages[0].pushName;
    const mensaje =
      event.messages[0].message?.conversation ||
      event.messages[0].message?.extendedTextMessage?.text ||
      event.messages[0].message?.text;

    // registrar al contacto
    let contacto = await Contacto.findOne({ where: { numero: id } });
    if (!contacto) {
      contacto = await Contacto.create({
        nombre: nombre,
        numero: id,
        saldo_pendiente: 0,
      });
    }

    let men = await Mensaje.create({
      mensaje: mensaje,
      contactoId: contacto.id,
    });
    // 59178844793
    if (!userContext[id]) {
      userContext[id] = { menuActual: "main", lista_mensajes: [] };
      enviarMenuPrincipal(sock, id, nombre);
      return;
    }

    const menuActual = userContext[id].menuActual;
    if (menuActual == "main") {
      switch (mensaje) {
        case "A":
          if (contacto.saldo_pendiente > 0) {
            await sock.sendMessage(id, {
              text:
                "Tienes una Deudas Pendientes.\nTu saldo pendiente a pagar es: $" +
                contacto.saldo_pendiente,
            });
          } else {
            await sock.sendMessage(id, {
              text: "No Tienes una Deudas Pendientes",
            });
          }
          break;
        case "B":
          userContext[id].menuActual = "soporte";
          await sock.sendMessage(id, {
            text: `Perfecto ${nombre},\n*Opción de Soporte:*\n\n- 👉 *1*: Problemas de Autenticación\n- 👉 *2*: Dirección\n- 👉 *3*: Volver al Menú\n\n> Elija una opción`,
          });
          return;
          break;
        case "C":
          userContext[id].menuActual = "main";
          enviarMenuPrincipal(sock, id, nombre);
          return;
          break;
        default:
          const respuestaIA = await obtenerRespuestaOpenAI(mensaje, id);

          let men2 = await Mensaje.create({
            mensaje: respuestaIA,
            contactoId: contacto.id,
          });

          await sock.sendMessage(id, { text: respuestaIA });
          return;
          break;
      }
    } else {
      switch (mensaje) {
        case "1":
          await sock.sendMessage(id, {
            text: "Puedes resetear tu cuenta en /resetear o comunicate con +59173277937",
          });
          const vcard =
            "BEGIN:VCARD\n" + // metadata of the contact card
            "VERSION:3.0\n" +
            "FN:Jeff Singh\n" + // full name
            "ORG:Ashoka Uni;\n" + // the organization of the contact
            "TEL;type=CELL;type=VOICE;waid=911234567890:+91 12345 67890\n" + // WhatsApp ID + phone number
            "END:VCARD";

          await sock.sendMessage(id, {
            contacts: {
              displayName: "Jeff",
              contacts: [{ vcard }],
            },
          });

          break;
        case "2":
          await sock.sendMessage(id, {
            location: {
              address: "Av 123, Z. ABC",
              degreesLatitude: 24.121231,
              degreesLongitude: 55.1121221,
            },
          });
          break;

        case "3":
          userContext[id].menuActual = "main";
          enviarMenuPrincipal(sock, id, nombre);
          return;
          break;

        default:
          const respuestaIA = await obtenerRespuestaOpenAI(mensaje, id);

          let men3 = await Mensaje.create({
            mensaje: respuestaIA,
            contactoId: contacto.id,
          });

          await sock.sendMessage(id, { text: respuestaIA });
          return;
          break;
      }
    }
  });

  // to storage creds (session info) when it updates
  sock.ev.on("creds.update", saveCreds);
}
// run in main file
connectToWhatsApp();

async function obtenerRespuestaOpenAI(mensaje, user_id) {
  console.log(mensaje);
  if (userContext[user_id]?.lista_mensajes.length == 0) {
    userContext[user_id].lista_mensajes = [
      {
        role: "system",
        content:
          "Actúa como un experto en ventas de equipos electrónicos y limítate a responder otras preguntas. Utiliza el formato enriquecido de WhatsApp para hacer más claras las respuestas, como se indica a continuación: 1. *Texto en cursiva*: _texto_ 2. **Texto en negrita**: *texto* 3. ~~Texto tachado~~: ~texto~ 4. `Texto en monoespaciado`: ```texto``` 5. Listas con viñetas: - *Elemento 1* - *Elemento 2* 6. Listas numeradas: 1. *Elemento 1* 2. *Elemento 2* 7. Citas: > texto 8. Código alineado: `texto` Recuerda que solo responderás preguntas relacionadas con la venta de equipos electrónicos.",
      },
      { role: "user", content: "Que productos ofreces?" },
      {
        role: "assistant",
        content:
          "Solamente contamos con Teclados (marca: ASUS, precio: 325.98, cantidad: 12) y Monitores(marca: ASUS, precio: 1599.98, cantidad: 5)",
      },
      { role: "user", content: "Quiero 2 teclados" },
      {
        role: "assistant",
        content:
          "¡Perfecto! Has elegido **2 teclados** de la marca ASUS. Aquí tienes los detalles de tu pedido:\n" +
          "\n" +
          "- *Producto:* Teclado ASUS\n" +
          "- *Cantidad:* 2\n" +
          "- *Precio unitario:* $325.98\n" +
          "- *Precio total:* $651.96\n" +
          "\n" +
          "Si deseas proceder con la compra o necesitas asistencia adicional, ¡por favor házmelo saber!",
      },
      { role: "user", content: "Que productos tiene?" },
      {
        role: "assistant",
        content:
          "Actualmente, tenemos los siguientes productos electrónicos disponibles:\n" +
          "\n" +
          "- *Teclados*\n" +
          "  - _Marca:_ ASUS\n" +
          "  - _Precio:_ $325.98\n" +
          "  - _Cantidad disponible:_ 12\n" +
          "\n" +
          "- *Monitores*\n" +
          "  - _Marca:_ ASUS\n" +
          "  - _Precio:_ $1599.98\n" +
          "  - _Cantidad disponible:_ 5\n" +
          "\n" +
          "Si necesitas más información sobre alguno de estos productos, ¡no dudes en preguntar!",
      },
      { role: "user", content: "Que marca de motor tiene?" },
      {
        role: "assistant",
        content:
          "Solamente ofrecemos la marca ASUS, ya que trabajamos solo con esa marca",
      },
    ];
  }

  userContext[user_id]?.lista_mensajes.push({ role: "user", content: mensaje });

  console.log("USER: ", userContext[user_id]);

  const respuesta = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o",
      store: true,
      messages: userContext[user_id]?.lista_mensajes,
    },
    {
      headers: {
        Authorization:
          "Bearer ",
        "Content-Type": "application/json",
      },
    }
  );

  console.log(respuesta.data.choices[0].message.content);

  userContext[user_id].lista_mensajes.push({
    role: "assistant",
    content: respuesta.data.choices[0].message.content,
  });

  return respuesta.data.choices[0].message.content;
}

async function enviarMenuPrincipal(sock, id, nombre) {
  await sock.sendMessage(id, {
    text: `Hola ${nombre}, soy un Bot con IA. Bienvenido\n*Consulta tus dudas:*\n\n- 👉 *A*: Consultas Deudas\n- 👉 *B*: Contactar Soporte\n- 👉 *C*: Volver al Menú\n\n> Elija una opción`,
  });
}
