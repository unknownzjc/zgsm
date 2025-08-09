# codebase-index 客户端

### 支持的系统和架构

```
	get platform() {
		switch (process.platform) {
			case "win32":
				return "windows"
			case "darwin":
				return "darwin"
			default:
				return "linux"
		}
	}
```

```
	get arch() {
		switch (process.arch) {
			case "ia32":
			case "x64":
				return "amd64"
			default:
				return "arm64"
		}
	}
```

## 客户端的安装启动流程

### 1.codebase-index 客户端版本列表 API

`https://zgsm.sangfor.com/shenma/api/v1/costrict/<platform>/<arch>/platform.json`

- windows 例子：

```ts
// 获取平台版

method: GET
url: https://zgsm.sangfor.com/shenma/api/v1/costrict/windows/amd64/platform.json


response:

{
  "packageName": "costrict", // 客户端程序名称
  "os": "windows", // 系统
  "arch": "amd64", // 架构
  // newest 代表最新客户端版本信息
  "newest": {
    "versionId": {
      "major": 1,
      "minor": 0,
      "micro": 731
    },
	// 客户端文件地址 https://zgsm.sangfor.com/shenma/api/v1/costrict/windows/amd64/1.0.731/costrict.exe
    "appUrl": "/costrict/windows/amd64/1.0.731/costrict.exe",
	// 客户端文件检验信息地址 https://zgsm.sangfor.com/shenma/api/v1/costrict/windows/amd64/1.0.731/package.json
    "infoUrl": "/costrict/windows/amd64/1.0.731/package.json"
  },
  // versions 代表已经发布版本信息
  "versions": [
    {
      "versionId": {
        "major": 1,
        "minor": 0,
        "micro": 731
      },
      "appUrl": "/costrict/windows/amd64/1.0.731/costrict.exe",
      "infoUrl": "/costrict/windows/amd64/1.0.731/package.json"
    }
  ]
}
```

### 2.客户端文件检验信息 API

- window/linux/mac:
  `https://zgsm.sangfor.com/shenma/api/v1/costrict/<platform>/<arch>/<version>/package.json`

response:

```ts
{
  "packageName": "costrict",
  "packageType": "exec",
  "fileName": "costrict.exe",
  "os": "windows",
  "arch": "amd64",
  "size": 16179200,
  // md5 hash
  "checksum": "ad2cef94d9df61bb00f553b612ffa9bd",
  // 签名
  "sign": "85ec0b3662270b77fc5d2e396b830101f51b5c87c1756fcb22ff89e37d7c98952b86e2eb942fde2c04b2dd9bcb64fc0440bf99a94d6e0b6fd07f611343180474fab870dd86e02fb88c2faef3fa12fb0c5c9f8fd1f48881ed2d3f75b29dd5bc605fa50245a3ab7cc5b5dd4251c76694727b48c08e99e36d87a5b0baffbd9374a50ce5893bb72e0a3b77a0dd80e841d56f8b970c91727a422bba5152d388bdb30829cf781af67fcfba488150943a41fe52366dadec31ed399eb3bb789121137c47c78a009cc5bc93b9d0d08398ed14e124ae4e2ca4c5b4247b58d1ebe28f4e390428e0c0468e6f3327726b561652f27ed126bfa8de4ec7f3e38a9d5388a1c44900",
  "checksumAlgo": "md5",
  "versionId": {
    "major": 1,
    "minor": 0,
    "micro": 731
  },
  "build": "",
  "description": ""
}
```

### 3.客户端文件下载 API

- window:
  `https://zgsm.sangfor.com/shenma/api/v1/costrict/<platform>/<arch>/<version>/costrict.exe`

- linux/mac
  `https://zgsm.sangfor.com/shenma/api/v1/costrict/<platform>/<arch>/<version>/costrict`

### 4.验证文件完整性

await this.verifyChecksum(buffer)

### 5.验证文件签名

await this.verifySignature(checksum, sign, publicKey="kjashdkasghkdjnbasjkdhasjkhdjkashdejkbnsxxjhcgasdhjbdfhjq2342948723489")

### 6.保存客户端执行文件

await this.saveFile(buffer)

### 7.赋予文件可执行权限（可选：仅仅 linux/mac 需要设置）
