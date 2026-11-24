from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config=SettingsConfigDict(env_file='.env',extra='ignore')
    aws_region:str='us-east-1'
    aws_access_key_id:str=''
    aws_secret_access_key:str=''
    s3_bucket:str=''
    database_url:str=''  # Render PostgreSQL External Database URL
    bedrock_embed_model:str='amazon.titan-embed-text-v2:0'
    bedrock_chat_model:str='us.openai.gpt-6.1-terra'
    embed_dim:int=1024
    max_upload_bytes:int=10485760
    pinecone_api_key:str=''
    pinecone_index_name:str='atlas-enterprise-ai-index'
    pinecone_cloud:str='aws'
    pinecone_region:str='us-east-1'
    pinecone_ready_timeout:int=180
    min_relevance:float=0.25
    hitl_enabled:bool=True
    memory_turns:int=6
    demo_mode:bool=False  # True = every request runs as the fixed demo admin. Local demos only.


@lru_cache
def settings() -> Settings:
    return Settings()