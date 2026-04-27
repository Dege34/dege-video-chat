# Dege Video Chat

Dege ile güçlendirilmiş çoklu kullanıcılı video sohbet uygulaması **20 satır kodla**, gerçek zamanlı yayın çözümü oluşturmayı gösterir.


Veya **_Doom_** diyebilirsiniz! 😂


## Gereksinimler

Öncelikle bir web kamerasına ihtiyacınız var.


## Kurulum

```bash
pip install -e ./dege_pkg
pip install docarray opencv-python numpy
```


## Sunucuyu Çalıştır

Sunucunun web kamerasına ihtiyacı yok tabii ki.

```bash
cd Dege-Video-Chat
dege flow --uses flow.yml
```

Sunucu adresini not edin.

### İstemciyi Çalıştır

```bash
pip install opencv-python
cd Dege-Video-Chat
python client.py grpcs://sunucu-adresi kullanici_adi
```

Burada `kullanici_adi` kullanıcı adıdır, diğer kullanıcılardan farklı olmalıdır.
