/**
 * Seed script — crea (o actualiza) la cuenta de alumna demo desde .env y le da
 * acceso sin vencimiento a todos los productos que existan.
 * Es idempotente: se vuelve a correr después de cargar contenido nuevo.
 * Uso: pnpm seed:student
 */
import "dotenv/config";
import mongoose from "mongoose";
import { env } from "../config/env";
import { Access } from "../models/access.model";
import { Product } from "../models/product.model";
import { User } from "../models/user.model";

async function main() {
  if (!env.DEMO_STUDENT_EMAIL || !env.DEMO_STUDENT_PASSWORD) {
    console.error("✖ DEMO_STUDENT_EMAIL o DEMO_STUDENT_PASSWORD no están definidas en .env");
    process.exit(1);
  }

  console.log("Conectando a MongoDB...");
  await mongoose.connect(env.DB_URI);

  let student = await User.findOne({ email: env.DEMO_STUDENT_EMAIL }).select("+password");

  if (student) {
    if (student.accountType !== "customer") {
      console.error(`✖ ${env.DEMO_STUDENT_EMAIL} ya existe y no es una cuenta de alumna`);
      await mongoose.disconnect();
      process.exit(1);
    }
    student.password = env.DEMO_STUDENT_PASSWORD;
    student.name = "Alumna Demo";
    student.isActive = true;
    await student.save();
    console.log(`✔ Alumna demo actualizada: ${env.DEMO_STUDENT_EMAIL}`);
  } else {
    student = await User.create({
      email: env.DEMO_STUDENT_EMAIL,
      password: env.DEMO_STUDENT_PASSWORD,
      name: "Alumna Demo",
      accountType: "customer",
    });
    console.log(`✔ Alumna demo creada: ${env.DEMO_STUDENT_EMAIL}`);
  }

  const products = await Product.find({}).select("title").lean();
  for (const product of products) {
    await Access.findOneAndUpdate(
      { user: student._id, product: product._id },
      { $set: { source: "demo", note: "Cuenta demo", expiresAt: null, revokedAt: null } },
      { upsert: true, setDefaultsOnInsert: true },
    );
    console.log(`  · acceso demo: ${product.title}`);
  }
  console.log(`✔ ${products.length} producto(s) con acceso demo`);

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error("✖ Falló el seed:", error);
  process.exit(1);
});
