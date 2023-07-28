const multiparty = require("multiparty");
const path = require("path");
const fse = require("fs-extra");

const UPLOAD_DIR = path.resolve(__dirname, "..", "chunks");

const extractExt = (filename) =>
  filename.slice(filename.lastIndexOf("."), filename.length);

const pipeStream = (path, writeStream) =>
  new Promise((resolve) => {
    const readStream = fse.createReadStream(path);
    readStream.on("end", () => {
      fse.unlinkSync(path);
      resolve();
    });
    readStream.pipe(writeStream);
  });

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
  path.resolve(UPLOAD_DIR, `strike_${fileHash}`);

const createUploadedList = async (fileHash) =>
  fse.existsSync(getChunkDir(fileHash))
    ? await fse.readdir(getChunkDir(fileHash))
    : [];

const mergeFileChunk = async (filePath, fileHash, size) => {
  const chunkDir = getChunkDir(fileHash);
  const chunkPaths = await fse.readdir(chunkDir);
  chunkPaths.sort((a, b) => a.split("-")[1] - b.split("-")[1]);

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
};
