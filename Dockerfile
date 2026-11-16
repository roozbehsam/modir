FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --timeout 120 --retries 10 -r requirements.txt
COPY app.py .
COPY static ./static
ENV DB_PATH=/data/modir.db
VOLUME /data
EXPOSE 3000
CMD ["gunicorn", "-w", "1", "--threads", "4", "-b", "0.0.0.0:3000", "app:app"]
