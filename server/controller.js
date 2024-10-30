const multiparty = require("multiparty");
const path = require("path");
const fse = require("fs-extra");
const sharp = require("sharp");
const { createCanvas, loadImage } = require("canvas");

const UPLOAD_DIR = path.resolve(__dirname, "..", "chunks");

const extractExt = (filename) =>
  filename.slice(filename.lastIndexOf("."), filename.length);

const resolvePost = (req) =>
  new Promise((resolve) => {
    let chunk = "";
    req.on("data", (data) => {
      chunk += data;
    });
    req.on("end", () => {
      resolve(JSON.parse(chunk));
    });
  });

const getChunkDir = (fileHash) =>
  path.resolve(UPLOAD_DIR, `example_${fileHash}`);

const createUploadedList = async (fileHash) =>
  fse.existsSync(getChunkDir(fileHash))
    ? await fse.readdir(getChunkDir(fileHash))
    : [];

const mergeFileChunk = async (filePath, fileHash, size) => {
  const chunkDir = getChunkDir(fileHash);
  const chunkPaths = await fse.readdir(chunkDir);
  chunkPaths.sort((a, b) => a.split("-")[1] - b.split("-")[1]);

  const pipeStream = (path, writeStream) =>
    new Promise((resolve) => {
      const readStream = fse.createReadStream(path);
      readStream.on("end", () => {
        fse.unlinkSync(path);
        resolve();
      });
      readStream.pipe(writeStream);
    });

  await Promise.all(
    chunkPaths.map((chunkPath, index) =>
      pipeStream(
        path.resolve(chunkDir, chunkPath),
        fse.createWriteStream(filePath, {
          start: index * size,
        })
      )
    )
  );
  fse.rmdirSync(chunkDir);
};

module.exports = class {
  async handleMerge(req, res) {
    const data = await resolvePost(req);
    const { fileHash, filename, size } = data;
    const ext = extractExt(filename);
    const filePath = path.resolve(UPLOAD_DIR, `${fileHash}${ext}`);
    await mergeFileChunk(filePath, fileHash, size);
    res.end(
      JSON.stringify({
        code: 0,
        message: "file merged success",
      })
    );
  }

  async deleteFiles(req, res) {
    await fse.remove(path.resolve(UPLOAD_DIR));
    res.end(
      JSON.stringify({
        code: 0,
        message: "file delete success",
      })
    );
  }

  async handleFormData(req, res) {
    const multipart = new multiparty.Form();

    multipart.parse(req, async (err, fields, files) => {
      if (err) {
        console.error(err);
        res.status = 500;
        res.end("process file chunk failed");
        return;
      }
      const [chunk] = files.chunk;
      const [hash] = fields.hash;
      const [fileHash] = fields.fileHash;
      const [filename] = fields.filename;
      const filePath = path.resolve(
        UPLOAD_DIR,
        `${fileHash}${extractExt(filename)}`
      );
      const chunkDir = getChunkDir(fileHash);
      const chunkPath = path.resolve(chunkDir, hash);

      if (fse.existsSync(filePath)) {
        res.end("file exist");
        return;
      }

      if (fse.existsSync(chunkPath)) {
        res.end("chunk exist");
        return;
      }

      if (!fse.existsSync(chunkDir)) {
        await fse.mkdirs(chunkDir);
      }

      await fse.move(chunk.path, path.resolve(chunkDir, hash));
      res.end("received file chunk");
    });
  }

  async handleVerifyUpload(req, res) {
    const data = await resolvePost(req);
    const { fileHash, filename } = data;
    const ext = extractExt(filename);
    const filePath = path.resolve(UPLOAD_DIR, `${fileHash}${ext}`);
    if (fse.existsSync(filePath)) {
      res.end(
        JSON.stringify({
          shouldUpload: false,
        })
      );
    } else {
      res.end(
        JSON.stringify({
          shouldUpload: true,
          uploadedList: await createUploadedList(fileHash),
        })
      );
    }
  }

  async mergeBase64Images(base64Images) {
    // Cargar todas las imágenes base64 en objetos de imagen de Canvas
    const images = await Promise.all(
      base64Images.map(async (base64) => {
        const img = await loadImage(`${base64}`);
        return img;
      })
    );

    console.log("HASTA ACA LLEGA BIEN?");

    // Determinar el tamaño del canvas en función de las imágenes
    const canvasHeight = Math.max(...images.map((img) => img.height));
    const canvasWidth = images.reduce((sum, img) => sum + img.width, 0);

    // Crear un canvas con el tamaño adecuado
    const canvas = createCanvas(canvasWidth * 0.5, canvasHeight * 0.5);
    const context = canvas.getContext("2d");

    // Dibujar cada imagen en el canvas
    let yOffset = 0;
    let xOffset = 0;
    images.forEach((img) => {
      context.drawImage(img, xOffset, yOffset, img.width, img.height);
      xOffset += img.width;
    });

    // Convertir el canvas a una imagen en base64
    return canvas.toDataURL();
  }

  saveBase64Image(base64String, outputPath) {
    // Remover el encabezado si existe (e.g., 'data:image/png;base64,')
    const base64Data = base64String.replace(/^data:image\/\w+;base64,/, "");

    // Convertir la cadena base64 en un buffer de datos binarios
    const imageBuffer = Buffer.from(base64Data, "base64");

    const pathLocation = path.resolve(UPLOAD_DIR, outputPath);

    // Escribir el buffer en el sistema de archivos
    fse.writeFile(pathLocation, imageBuffer, (err) => {
      if (err) {
        console.error("Error guardando la imagen:", err);
      } else {
        console.log("Imagen guardada exitosamente en:", outputPath);
      }
    });
  }

  async resizeBase64Image(base64Image, scaleFactor) {
    // Cargar la imagen desde el string base64
    const img = await loadImage(`${base64Image}`);

    // Calcular las nuevas dimensiones
    const newWidth = Math.floor(img.width * scaleFactor);
    const newHeight = Math.floor(img.height * scaleFactor);

    // Crear un nuevo canvas con las nuevas dimensiones
    const canvas = createCanvas(newWidth, newHeight);
    const context = canvas.getContext("2d");

    // Redimensionar y dibujar la imagen en el nuevo canvas
    context.drawImage(img, 0, 0, newWidth, newHeight);

    // Devolver la nueva imagen redimensionada en base64
    return canvas.toDataURL();
  }

  async mergeBase64Images2(base64Images, height) {
    // Redimensionar cada imagen y convertirla en un buffer
    const buffers = await Promise.all(
      base64Images.map(async (base64) => {
        const imageBuffer = Buffer.from(
          base64.replace(/^data:image\/\w+;base64,/, ""),
          "base64"
        );
        return await sharp(imageBuffer)
          .resize({ height: height, withoutEnlargement: true }) // Redimensionar a una altura fija
          .toBuffer();
      })
    );

    // Obtener los metadatos de las imágenes redimensionadas
    const metadataPromises = buffers.map((buffer) => sharp(buffer).metadata());
    const metadatas = await Promise.all(metadataPromises);

    // Calcular el ancho total del canvas combinando las imágenes horizontalmente
    const totalWidth = metadatas.reduce(
      (sum, metadata) => sum + metadata.width,
      0
    );

    // Crear una imagen vacía con el ancho total y la altura especificada
    const combinedBuffer = await sharp({
      create: {
        width: totalWidth,
        height: height,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 0 }, // Fondo transparente
      },
    })
      .composite(
        buffers.map((buffer, i) => ({
          input: buffer,
          left: metadatas
            .slice(0, i)
            .reduce((sum, meta) => sum + meta.width, 0), // Posicionar a la derecha de la imagen anterior
          top: 0,
        }))
      )
      .png()
      .toBuffer();

    // Convertir el buffer combinado de vuelta a base64
    return combinedBuffer.toString("base64");
  }

  async mergeAndSaveImages(req, res) {
    const data = await resolvePost(req);
    const { chunks } = data;

    const scaleFactor = 0.5;

    try {
      const resizedImages = await Promise.all(
        chunks.map(
          async (base64) => await this.resizeBase64Image(base64, scaleFactor)
        )
      );

      const height = 800;

      // Combinar las imágenes en base64
      const mergedImageBase64 = await this.mergeBase64Images2(chunks, height);

      const outputPath = "./full-image-large.png";
      // Guardar la imagen combinada en un archivo local
      this.saveBase64Image(mergedImageBase64, outputPath);

      res.end(
        JSON.stringify({
          code: 0,
          message: "file merged success",
        })
      );
    } catch (error) {
      console.error("Error durante el proceso:", error);
      res.end(
        JSON.stringify({
          code: 1,
          message: "file merged failed",
        })
      );
    }
  }
};
