import Head from "next/head";
import { useState } from "react";
import { Inter } from "next/font/google";
import styles from "@/styles/Home.module.css";

const inter = Inter({ subsets: ["latin"] });

const Status = {
  nothing: "",
  wait: "wait",
  pause: "pause",
  uploading: "uploading",
};

const MB = 1024 * 1024;
const SIZE_IN_MB = 5;
const SIZE = SIZE_IN_MB * MB;

export default function Home() {
  const [loadedFile, setFile] = useState();
  const [hash, sethash] = useState("");
  const [status, setStatus] = useState(Status.nothing);
  const [requestList, setRequestList] = useState([]);
  const [hashPercentage, setHashPercentage] = useState();
  const [data, setData] = useState([]);

  const handleFileChange = (e) => {
    const [file] = e.target.files;
    if (!file) return;
    setFile(file);
  };

  const createFileChunk = (file, size = SIZE) => {
    const fileChunkList = [];
    let currentPosition = 0;
    while (currentPosition < file.size) {
      const filePortion = file.slice(currentPosition, currentPosition + size);
      fileChunkList.push({ file: filePortion });
      currentPosition += size;
    }
    return fileChunkList;
  };

  const calculateHash = (fileChunkList) => {
    return new Promise((resolve) => {
      let worker = new Worker("/hash.js");
      worker.postMessage({ fileChunkList });
      worker.onmessage = (e) => {
        const { percentage, hash } = e.data;
        setHashPercentage(percentage);
        if (hash) {
          resolve(hash);
        }
      };
    });
  };

  const request = ({
    url,
    method = "post",
    data: reqData,
    headers = {},
    onProgress = (e) => e,
    requestList,
  }) => {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = onProgress;
      xhr.open(method, url);
      Object.keys(headers).forEach((key) =>
        xhr.setRequestHeader(key, headers[key])
      );
      xhr.send(reqData);
      xhr.onload = (e) => {
        if (requestList) {
          const xhrIndex = requestList.findIndex((item) => item === xhr);
          requestList.splice(xhrIndex, 1);
        }
        resolve({
          data: e.target.response,
        });
      };
      requestList?.push(xhr);
    });
  };

  const verifyUpload = async (filename, fileHash) => {
    const { data: resData } = await request({
      url: "http://localhost:3001/verify",
      headers: {
        "content-type": "application/json",
      },
      data: JSON.stringify({
        filename,
        fileHash,
      }),
    });
    return JSON.parse(resData);
  };

  const mergeRequest = async () => {
    setStatus(Status.uploading);
    await request({
      url: "http://localhost:3001/merge",
      headers: {
        "content-type": "application/json",
      },
      data: JSON.stringify({
        size: SIZE,
        fileHash: hash,
        filename: loadedFile.name,
      }),
    });
    console.log("upload success, check /chunks directory");
    setStatus(Status.wait);
    setData([
      {
        fileHash: data[0].fileHash,
        hash: data[0].fileHash,
        size: loadedFile.size,
      },
    ]);
  };

  const createProgressHandler = (item) => {
    return (e) => {
      item.percentage = parseInt(String((e.loaded / e.total) * 100));
    };
  };

  const uploadChunks = async (uploadedList = [], currentData, fileHash) => {
    const localRequestList = currentData
      .map(({ chunk, hash, index }) => {
        const formData = new FormData();
        formData.append("chunk", chunk);
        formData.append("hash", hash);
        formData.append("filename", loadedFile.name);
        formData.append("fileHash", fileHash);
        formData.append("length", chunk.size);
        formData.append("Content-Type", "multipart/form-data");
        console.log("DEBERIA ENTRAR", formData, index, chunk, hash);
        return { formData, index };
      })
      .map(({ formData, index }) =>
        request({
          url: "http://localhost:3001",
          data: formData,
          onProgress: createProgressHandler(currentData[index]),
          requestList: requestList,
        })
      );
    setStatus(Status.uploading);
    await Promise.all(localRequestList);
    setStatus(Status.wait);
    /*if (uploadedList.length + requestList.length === currentData.length) {
      await mergeRequest(fileHash);
    }*/
  };

  const handleUpload = async () => {
    if (!loadedFile) return;
    setStatus(Status.uploading);
    const fileChunkList = createFileChunk(loadedFile);
    //const newHash = await calculateHash(fileChunkList);
    const newHash = loadedFile.name;
    sethash(newHash);

    const { shouldUpload, uploadedList } = await verifyUpload(
      loadedFile.name,
      newHash
    );
    if (!shouldUpload) {
      console.log("skip upload：file upload success, check /target directory");
      setStatus(Status.wait);
      return;
    }

    const currentData = fileChunkList.map(({ file }, index) => ({
      fileHash: newHash,
      index,
      hash: `${newHash}-${index}`,
      chunk: file,
      size: file.size,
      percentage: uploadedList.includes(index) ? 100 : 0,
    }));

    setData(currentData);

    await uploadChunks(uploadedList, currentData, newHash);
  };

  const resetData = () => {
    requestList.forEach((xhr) => xhr?.abort());
    setRequestList([]);
    setData([]);
  };

  const handleDelete = async () => {
    const { data: resData } = await request({
      url: "http://localhost:3001/delete",
    });
    if (JSON.parse(resData).code === 0) {
      console.log("delete success");
    }
    resetData();
  };

  const calculateSize = (sizeInB) => {
    const roundSize = Math.round(sizeInB / MB);
    if (roundSize >= 1) return `${roundSize} Mb`;

    return `${Math.round(sizeInB / 1024)} Kb`;
  };

  return (
    <>
      <Head>
        <title>Create Next App</title>
        <meta name="description" content="Generated by create next app" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <main className={`${styles.main} ${inter.className}`}>
        <input onChange={handleFileChange} type="file" />
        <button
          disabled={!loadedFile || status === Status.uploading}
          onClick={handleUpload}
        >
          UPLOAD
        </button>
        {data?.length ? (
          <div>
            <p
              style={{
                marginBottom: "20px",
                fontWeight: "bold",
                fontSize: "20px",
              }}
            >
              {data[0].fileHash}
            </p>
            {data?.map(({ hash, percentage, size }) => (
              <div key={hash} style={{ display: "flex", gap: "40px" }}>
                <p>{hash}</p>
                <p>{calculateSize(size)}</p>
                <progress value={percentage || 0} max="100" />
              </div>
            ))}
          </div>
        ) : null}
        <div style={{ color: "white" }}>
          <button
            disabled={!data.length || status === Status.uploading}
            onClick={handleDelete}
          >
            DELETE
          </button>
          <button
            disabled={!data.length || status === Status.uploading}
            onClick={mergeRequest}
          >
            MERGE
          </button>
        </div>
      </main>
    </>
  );
}
