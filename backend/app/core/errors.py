from app.schemas import ErrorDetail, ErrorResponse


class APIError(Exception):
    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.body = ErrorResponse(error=ErrorDetail(code=code, message=message))
