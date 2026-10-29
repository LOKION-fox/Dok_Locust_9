import random
from faker import Faker
from locust import HttpUser, TaskSet, SequentialTaskSet, task, between
from locust.exception import StopUser

fake = Faker("ru_RU")


class AdminTasks(TaskSet):

    @task(10)
    def get_clients(self):
        self.client.get(
            "/api/clients",
            params={"client_type": random.choice(["ALL", "PERSON", "COMPANY"])},
            name="GET Клиенты"
        )

    @task(10)
    def get_vehicles(self):
        self.client.get(
            "/api/vehicles",
            params={"sort": "newest"},
            name="GET Автомобили"
        )

    @task(10)
    def get_parts(self):
        self.client.get(
            "/api/parts",
            params={"stock": random.choice(["all", "positive", "zero"])},
            name="GET Запчасти"
        )

    @task(1)
    def create_client(self):
        data = {
            "client_type": "PERSON",
            "name": f"{fake.last_name_female()} {fake.first_name_female()} {fake.middle_name_female()}",
            "phone": f"+7-9{random.randint(10, 99)}-{random.randint(0, 999):03d}-{random.randint(0, 99):02d}-{random.randint(0, 99):02d}",
            "email": fake.safe_email(),
            "address": f"г. Москва, ул. Лесная, д. {random.randint(1, 200)}",
            "comment": "Создано Locust"
        }

        with self.client.post(
            "/api/clients",
            json=data,
            name="POST Создание клиента",
            catch_response=True
        ) as response:
            if response.status_code != 201:
                response.failure(f"Ошибка создания: {response.status_code}")


class OrderSteps(SequentialTaskSet):

    @task
    def get_order_data(self):
        self.client.get(
            "/api/work-orders/meta",
            name="GET Данные заказа"
        )

    @task
    def get_orders(self):
        self.client.get(
            "/api/work-orders",
            params={"scope": "active"},
            name="GET Активные заказы"
        )


class AdminUser(HttpUser):
    weight = 3
    wait_time = between(1, 2)
    tasks = [AdminTasks]

    def on_start(self):
        self.login()

    def login(self):
        response = self.client.post(
            "/api/auth/login",
            json={"login": "admin", "password": "admin123"},
            name="Авторизация"
        )

        if response.status_code != 200:
            raise StopUser()

        token = response.json().get("token")

        if not token:
            raise StopUser()

        self.client.headers["Authorization"] = f"Bearer {token}"


class SequenceUser(AdminUser):
    weight = 1
    tasks = [OrderSteps]
